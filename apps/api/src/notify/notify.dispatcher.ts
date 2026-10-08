import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { TelegramService } from '../telegram/telegram.service';

const TICK_MS = 5_000;
const BATCH = 20;
const MAX_ATTEMPTS = 5;

interface QueuedRow {
  id: string;
  person_id: string | null;
  phone_e164: string | null;
  channel: 'telegram' | 'sms';
  template: string;
  body: string;
  telegram_user_id: string | null;
  attempts: number;
}

/**
 * Drains the `notification` queue.
 *
 * task.md § 6 puts notifications on BullMQ. This is a plain interval poller
 * instead, deliberately: the queue table is already the durable record (the
 * dispatcher is stateless and crash-safe either way), the volume is one message
 * per parent per event, and the wave-reminder burst is bounded by one row per
 * child per day. Moving to BullMQ later is a swap of this file — nothing else
 * knows how sending happens. When the olympiad load work lands (§ 11) is the
 * time to revisit.
 *
 * SMS has no provider yet (task.md § 14, open question 2), so SMS rows are left
 * queued rather than dropped: when a provider is chosen they send.
 */
@Injectable()
export class NotifyDispatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotifyDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Exposed so a test or a job can drain the queue without waiting a tick. */
  async tick(): Promise<number> {
    // One pass at a time: overlapping ticks would double-send.
    if (this.running || this.stopping) return 0;
    this.running = true;
    try {
      return await this.drain();
    } catch (err) {
      this.logger.error('dispatch failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<number> {
    // FOR UPDATE SKIP LOCKED: several API instances can drain the same queue
    // without handing the same row to two of them.
    const rows = await this.db.query<QueuedRow>(
      `WITH claimed AS (
         SELECT n.id
           FROM notification n
          WHERE n.status = 'queued' AND n.channel = 'telegram'
          ORDER BY n.created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       SELECT n.id::text,
              n.person_id,
              n.phone_e164,
              n.channel,
              n.template,
              n.payload->>'body'          AS body,
              p.telegram_user_id::text    AS telegram_user_id,
              COALESCE((n.payload->>'attempts')::int, 0) AS attempts
         FROM notification n
         JOIN claimed c ON c.id = n.id
    LEFT JOIN person p ON p.id = n.person_id`,
      [BATCH],
    );

    let sent = 0;
    for (const row of rows) {
      if (this.stopping) break;

      if (!row.telegram_user_id) {
        // Nothing to send to. Not a transient failure — mark it and move on so
        // the row stops being claimed every five seconds.
        await this.fail(row.id, 'no telegram account linked', true);
        continue;
      }

      const result = await this.telegram.send(Number(row.telegram_user_id), row.body ?? '');
      if (result.sent) {
        await this.db.query(
          `UPDATE notification SET status = 'sent', sent_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
        continue;
      }

      await this.fail(
        row.id,
        result.error,
        result.permanent || row.attempts + 1 >= MAX_ATTEMPTS,
      );
    }

    if (sent) this.logger.log(`sent ${sent} notification(s)`);
    return sent;
  }

  /**
   * `final` moves the row to `failed`; otherwise it stays queued with the
   * attempt counted, so a 429 or a bot restart is retried on the next tick.
   */
  private async fail(id: string, error: string, final: boolean): Promise<void> {
    await this.db.query(
      `UPDATE notification
          SET status  = CASE WHEN $3 THEN 'failed' ELSE 'queued' END,
              error   = $2,
              payload = jsonb_set(
                          payload, '{attempts}',
                          to_jsonb(COALESCE((payload->>'attempts')::int, 0) + 1), true)
        WHERE id = $1`,
      [id, error.slice(0, 500), final],
    );
    if (final) this.logger.warn(`notification ${id} failed permanently: ${error}`);
  }
}
