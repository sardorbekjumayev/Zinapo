import { Body, Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { LoginRequestService } from '../auth/login-request.service';
import { toE164 } from '../common/phone.util';
import { BotReply, TelegramFlowService } from '../telegram/telegram-flow.service';

interface SimulateDto {
  /** Deep link or the raw `start` token. */
  link: string;
  phone: string;
  tgUserId?: number;
  firstName?: string;
  lastName?: string;
  /** Set to a different id to simulate a forwarded / foreign contact. */
  contactUserId?: number;
}

interface ShareContactDto {
  /** The number typed on the site; the newest live request for it is used. */
  phone: string;
  tgUserId?: number;
  firstName?: string;
  lastName?: string;
}

/**
 * Development-only stand-in for Telegram. It drives exactly the same
 * TelegramFlowService the webhook uses, so the whole sign-in flow can be
 * exercised without a bot token. Returns the bot's replies — including the
 * code — which is why it 404s outside development.
 */
@Controller('dev/telegram')
export class DevController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly flow: TelegramFlowService,
    private readonly login: LoginRequestService,
    private readonly redis: RedisService,
  ) {}

  private guard(): void {
    if (this.config.isProd) throw new NotFoundException();
  }

  private token(link: string): string {
    const match = /[?&]start=([A-Za-z0-9_-]+)/.exec(link);
    return match ? match[1] : link.trim();
  }

  /** `/start <token>` + sharing the contact, in one call. */
  @Post('simulate')
  async simulate(@Body() dto: SimulateDto): Promise<{ replies: BotReply[] }> {
    this.guard();
    const tgUserId = dto.tgUserId ?? 100_000_001;

    const started = await this.flow.onStart(this.token(dto.link), tgUserId, tgUserId);
    const contact = await this.flow.onContact(tgUserId, {
      userId: dto.contactUserId ?? tgUserId,
      phoneNumber: dto.phone,
      firstName: dto.firstName ?? 'Test',
      lastName: dto.lastName ?? 'Foydalanuvchi',
    });

    return { replies: [...started, ...contact] };
  }

  /**
   * Same as `simulate`, but finds the request by phone number instead of
   * needing the deep link — so you can press "Kodni yuborish" in the browser
   * and then fetch the code from a terminal. Scanning Redis for the request is
   * fine here precisely because this endpoint never exists in production.
   */
  @Post('share-contact')
  async shareContact(@Body() dto: ShareContactDto): Promise<{ replies: BotReply[] }> {
    this.guard();

    const phone = toE164(dto.phone);
    if (!phone) throw new NotFoundException({ error: 'PHONE_INVALID' });

    const request = await this.findNewestRequestForPhone(phone);
    if (!request) throw new NotFoundException({ error: 'NO_PENDING_REQUEST' });

    const tgUserId = dto.tgUserId ?? 100_000_001;
    const linked = await this.login.linkTelegram(request, tgUserId, tgUserId);
    if (!linked) throw new NotFoundException({ error: 'REQUEST_BOUND_TO_OTHER_ACCOUNT' });

    return {
      replies: await this.flow.onContact(tgUserId, {
        userId: tgUserId,
        phoneNumber: phone,
        firstName: dto.firstName ?? 'Test',
        lastName: dto.lastName ?? 'Foydalanuvchi',
      }),
    };
  }

  @Post('new-code')
  async newCode(@Body() body: { tgUserId?: number }): Promise<{ replies: BotReply[] }> {
    this.guard();
    return { replies: await this.flow.onNewCode(body.tgUserId ?? 100_000_001) };
  }

  @Post('not-me')
  async notMe(@Body() body: { tgUserId?: number }): Promise<{ replies: BotReply[] }> {
    this.guard();
    return { replies: await this.flow.onNotMe(body.tgUserId ?? 100_000_001) };
  }

  private async findNewestRequestForPhone(phone: string) {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        'login:req:*',
        'COUNT',
        200,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');

    const candidates = [];
    for (const key of keys) {
      const request = await this.login.find(key.replace('login:req:', ''));
      if (!request || request.phone !== phone) continue;
      if (request.status !== 'PENDING' && request.status !== 'TG_LINKED') continue;
      candidates.push(request);
    }

    candidates.sort((a, b) => b.createdAt - a.createdAt);
    return candidates[0] ?? null;
  }
}
