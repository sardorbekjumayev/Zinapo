import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { NotifyChannel, NotifyRequest } from './notify.types';
import { render } from './templates';

/**
 * task.md § 6 (`notify`) and § 10.
 *
 * `queue` only writes a row; `NotifyDispatcher` sends it. That split is what
 * makes a notification safe to emit from inside a transaction: if the
 * transaction rolls back, the message was never queued, so a parent is never
 * told about an access grant that did not happen.
 *
 * Three rules are enforced here rather than at the call sites:
 *   · never message a child — children have no `person` row, so there is
 *     nothing to address; `personId` always belongs to an adult
 *   · never message a parent about an educator whose link has expired
 *   · throttle, via `notification.throttle_key`
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Queues one message. Pass `client` to join the caller's transaction.
   *
   * Returns the row id, or null when the message was dropped — throttled, or
   * addressed to nobody. A drop is normal and is not an error.
   */
  async queue(req: NotifyRequest, client?: PoolClient): Promise<string | null> {
    if (!req.personId && !req.phone) {
      this.logger.warn(`${req.template} had no recipient; dropped`);
      return null;
    }

    const run = client
      ? <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
          client.query<T>(sql, params as never[]).then((r) => r.rows)
      : <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
          this.db.query<T>(sql, params);

    // Telegram first for anyone registered; SMS only for a number we have no
    // person for (sign-in links every person's Telegram, task.md § 10).
    const channel: NotifyChannel = req.channel ?? (req.personId ? 'telegram' : 'sms');

    const locale = req.personId
      ? ((
          await run<{ locale: string }>(`SELECT locale FROM person WHERE id = $1`, [req.personId])
        )[0]?.locale ?? 'uz')
      : 'uz';

    const body = render(req.template, locale, req.vars);

    const rows = await run<{ id: string }>(
      `INSERT INTO notification (person_id, phone_e164, channel, template, payload, throttle_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (throttle_key) DO NOTHING
       RETURNING id::text`,
      [
        req.personId ?? null,
        req.phone ?? null,
        channel,
        req.template,
        // The rendered body is stored so the dispatcher never re-renders with
        // different copy, and so a support person can see exactly what was sent.
        JSON.stringify({ body, vars: req.vars, locale }),
        req.throttleKey ?? null,
      ],
    );

    if (rows.length === 0) {
      this.logger.log(`${req.template} throttled (${req.throttleKey})`);
      return null;
    }
    return rows[0].id;
  }

  /**
   * task.md § 10, rule 2: never message a parent about an educator whose link
   * has expired. Used by the expiry-warning job and by anything that reacts to
   * an educator event late.
   */
  async queueAboutEducatorLink(
    linkId: string,
    req: Omit<NotifyRequest, 'personId'>,
  ): Promise<string | null> {
    const row = await this.db.one<{ owner_id: string }>(
      `SELECT g.person_id AS owner_id
         FROM educator_link el
         JOIN guardianship g
           ON g.child_id = el.child_id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE el.id = $1
          AND el.valid_until > now()
          AND el.revoked_at IS NULL`,
      [linkId],
    );
    if (!row) {
      this.logger.log(`${req.template} suppressed: link ${linkId} is expired or revoked`);
      return null;
    }
    return this.queue({ ...req, personId: row.owner_id });
  }
}
