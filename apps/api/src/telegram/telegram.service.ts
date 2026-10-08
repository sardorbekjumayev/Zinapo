import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Context, Markup, Telegraf, TelegramError } from 'telegraf';
import { Update } from 'telegraf/types';
import { AppConfig, CONFIG } from '../config/configuration';
import { BotReply, TelegramFlowService } from './telegram-flow.service';

/** Backoff between long-polling restarts: 1s, 2s, 4s … capped at a minute. */
const POLL_RETRY_BASE_MS = 1_000;
const POLL_RETRY_MAX_MS = 60_000;

@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;
  /** Set on shutdown so the polling loop stops resurrecting itself. */
  private stopping = false;
  private pollRetries = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly flow: TelegramFlowService,
  ) {}

  get enabled(): boolean {
    return this.bot !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.telegram.enabled) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is empty — the bot is disabled. In development, drive the flow through /api/dev/telegram/*.',
      );
      return;
    }

    this.bot = new Telegraf(this.config.telegram.token);
    this.registerHandlers(this.bot);

    if (this.config.telegram.webhookUrl) {
      await this.bot.telegram.setWebhook(this.config.telegram.webhookUrl, {
        secret_token: this.config.telegram.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
      this.logger.log(`Telegram webhook set to ${this.config.telegram.webhookUrl}`);
    } else {
      // No public HTTPS URL in local dev — fall back to long polling.
      await this.bot.telegram.deleteWebhook().catch(() => undefined);
      this.startPolling(this.bot);
      this.logger.log('Telegram bot started in long-polling mode');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    // stop() throws when nothing is running — in webhook mode nothing ever is.
    try {
      this.bot?.stop('SIGTERM');
    } catch {
      /* not running */
    }
  }

  /**
   * Telegraf retries network errors, 429 and 5xx inside its own loop, but a 401
   * or a 409 ("terminated by other getUpdates request") escapes `launch()`.
   * Unhandled, that rejection takes the whole process down, and even caught it
   * would leave the bot deaf for the rest of its life. A 409 is transient — a
   * redeploy overlapping with the old instance, or someone poking getUpdates by
   * hand — so back off and come back up. A 401 means the token is wrong, and no
   * amount of retrying fixes that.
   */
  private startPolling(bot: Telegraf): void {
    this.pollTimer = null;
    const startedAt = Date.now();

    void bot.launch().catch((err: unknown) => {
      if (this.stopping) return;

      if (err instanceof TelegramError && err.code === 401) {
        this.logger.error('Telegram rejected the bot token (401) — the bot stays off.');
        return;
      }

      // Polling that ran for a while was healthy; only a fast re-failure escalates.
      if (Date.now() - startedAt > POLL_RETRY_MAX_MS) this.pollRetries = 0;

      const delay = Math.min(POLL_RETRY_BASE_MS * 2 ** this.pollRetries, POLL_RETRY_MAX_MS);
      this.pollRetries += 1;
      this.logger.error(
        `Long polling stopped (${(err as Error).message}); restarting in ${delay / 1000}s`,
      );
      this.pollTimer = setTimeout(() => this.startPolling(bot), delay);
      this.pollTimer.unref();
    });
  }

  /** Entry point for the webhook controller. */
  async handleUpdate(update: Update): Promise<void> {
    if (!this.bot) return;
    await this.bot.handleUpdate(update);
  }

  /**
   * Sends an outbound message — the notification channel (task.md § 10).
   *
   * `sent: false` with a `permanent` flag tells the dispatcher whether to
   * retry. A person who blocked the bot (403) will never accept the message, so
   * retrying forever would just fill the queue; a 429 or a 5xx is worth another
   * go.
   */
  async send(
    chatId: number,
    text: string,
  ): Promise<{ sent: true } | { sent: false; permanent: boolean; error: string }> {
    if (!this.bot) {
      // No token in development: the queue still fills, nothing is sent, and
      // the rows are visible for inspection.
      return { sent: false, permanent: false, error: 'bot_disabled' };
    }
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: undefined });
      return { sent: true };
    } catch (err) {
      const code = err instanceof TelegramError ? err.response?.error_code : undefined;
      // 400 — bad chat id; 403 — the person blocked the bot. Neither improves.
      const permanent = code === 400 || code === 403;
      return { sent: false, permanent, error: `${code ?? 'unknown'}: ${(err as Error).message}` };
    }
  }

  private registerHandlers(bot: Telegraf): void {
    bot.start(async (ctx) => {
      const token = (ctx as Context & { startPayload?: string }).startPayload;
      await this.reply(ctx, await this.flow.onStart(token, ctx.from.id, ctx.chat.id));
    });

    bot.on('contact', async (ctx) => {
      const contact = ctx.message.contact;
      await this.reply(
        ctx,
        await this.flow.onContact(ctx.from.id, {
          userId: contact.user_id,
          phoneNumber: contact.phone_number,
          firstName: contact.first_name,
          lastName: contact.last_name,
        }),
      );
    });

    bot.action('new_code', async (ctx) => {
      await ctx.answerCbQuery();
      await this.reply(ctx, await this.flow.onNewCode(ctx.from.id));
    });

    bot.action('not_me', async (ctx) => {
      await ctx.answerCbQuery();
      await this.reply(ctx, await this.flow.onNotMe(ctx.from.id));
    });

    bot.catch((err) => this.logger.error('telegraf error', err as Error));
  }

  private async reply(ctx: Context, replies: BotReply[]): Promise<void> {
    for (const r of replies) {
      const extra: Record<string, unknown> = {};
      if (r.markdown) extra.parse_mode = 'Markdown';

      if (r.keyboard === 'contact') {
        extra.reply_markup = Markup.keyboard([
          Markup.button.contactRequest(r.contactLabel ?? 'Share'),
        ])
          .resize()
          .oneTime().reply_markup;
      } else if (r.keyboard === 'remove') {
        extra.reply_markup = Markup.removeKeyboard().reply_markup;
      } else if (r.inline) {
        const labels = this.flow.labels(r.lang ?? 'uz');
        extra.reply_markup = Markup.inlineKeyboard([
          Markup.button.callback(labels.newCode, 'new_code'),
          Markup.button.callback(labels.notMe, 'not_me'),
        ]).reply_markup;
      }

      await ctx.reply(r.text, extra);
    }
  }
}
