import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { toE164 } from '../common/phone.util';
import { Actor } from '../authz';
import { PinflService } from '../identity/pinfl.service';
import { SeasonLookup } from '../identity/season.lookup';
import { REQUEST_TTL_DAYS } from '../identity/access.service';
import { maskedName, nextTashkentMidnight, normaliseFamilyName, randomCode, tashkentDay } from './educator.util';

/** design/10: "The link works for 14 days". */
export const INVITE_TTL_DAYS = 14;
/** design/10: "You can send the next one in 3 days." */
export const REMIND_EVERY_DAYS = 3;
/** One paste is one group; more than this is not a group. */
export const MAX_PHONES_PER_BATCH = 200;
/** § 8.4.2: 25 checks a day, 3 misses in a row → 1 h cooldown. */
export const MATCH_DAILY_LIMIT = 25;
export const MATCH_MISSES_BEFORE_PAUSE = 3;
export const MATCH_PAUSE_SEC = 3600;
/** A match token lives long enough to read the result and press "Ask the parent". */
const MATCH_TOKEN_TTL_SEC = 15 * 60;

const keys = {
  day: (p: string) => `zn:mc:day:${p}:${tashkentDay()}`,
  misses: (p: string) => `zn:mc:miss:${p}`,
  pause: (p: string) => `zn:mc:pause:${p}`,
  token: (t: string) => `zn:mc:tok:${t}`,
};

export type InviteState = 'joined' | 'waiting' | 'expired';

/**
 * task.md § 8.4.2 — how an educator reaches a child. There is no "add pupil":
 *
 *   1. bulk phone invites — the SMS carries the educator's public code; the
 *      parent registers and the access toggle is pre-filled (M2's wizard);
 *   2. a child already registered — a PINFL + family-name MATCH-CHECK that
 *      answers only match / no match with a masked name, rate-limited and
 *      logged, then an access request the owner approves or declines.
 *
 * Either way the owner decides. Nothing here writes an ACTIVE link.
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly pinfl: PinflService,
    private readonly seasons: SeasonLookup,
  ) {}

  // ============================================================ invites

  async send(actor: Actor, rawPhones: string[]) {
    if (rawPhones.length > MAX_PHONES_PER_BATCH) {
      throw new BadRequestException({ error: 'TOO_MANY_PHONES', details: { max: MAX_PHONES_PER_BATCH } });
    }
    const me = await this.educator(actor);

    const invalid: { line: number; value: string }[] = [];
    const unique = new Map<string, number>();
    let duplicates = 0;
    rawPhones.forEach((raw, i) => {
      if (!raw.trim()) return;
      const phone = toE164(raw);
      if (!phone) invalid.push({ line: i + 1, value: raw.slice(0, 40) });
      else if (unique.has(phone)) duplicates += 1;
      else unique.set(phone, i + 1);
    });
    unique.delete(me.phone);

    const sent: string[] = [];
    let alreadyInvited = 0;
    for (const phone of unique.keys()) {
      const created = await this.db.transaction(async (client) => {
        // An invite nobody answered in 14 days is over; it must not block a new one.
        await client.query(
          `UPDATE educator_invite SET cancelled_at = now()
            WHERE educator_person_id = $1 AND phone_e164 = $2 AND accepted_at IS NULL
              AND cancelled_at IS NULL AND expires_at <= now()`,
          [actor.personId, phone],
        );
        const live = await client.query(
          `SELECT 1 FROM educator_invite
            WHERE educator_person_id = $1 AND phone_e164 = $2 AND accepted_at IS NULL AND cancelled_at IS NULL`,
          [actor.personId, phone],
        );
        if (live.rowCount) return null;
        const code = randomCode(8);
        await client.query(
          `INSERT INTO educator_invite (educator_person_id, phone_e164, code, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
          [actor.personId, phone, code, INVITE_TTL_DAYS],
        );
        return code;
      });
      if (!created) {
        alreadyInvited += 1;
        continue;
      }
      await this.sms(phone, me, created);
      sent.push(phone);
    }

    if (sent.length) {
      await this.audit.write({ action: 'educator.invites_sent', personId: actor.personId, payload: { count: sent.length } });
    }
    return { sent: sent.length, alreadyInvited, duplicates, invalid, expiresInDays: INVITE_TTL_DAYS };
  }

  async list(actor: Actor) {
    const rows = await this.db.query<{
      id: string;
      phone: string;
      created_at: Date;
      expires_at: Date;
      last_reminded_at: Date | null;
      accepted_at: Date | null;
      shared: boolean;
    }>(
      `SELECT ei.id, ei.phone_e164 AS phone, ei.created_at, ei.expires_at, ei.last_reminded_at, ei.accepted_at,
              -- "joined and shared": the parent who accepted owns a child this educator can now see.
              EXISTS (SELECT 1 FROM guardianship g
                        JOIN v_educator_visible_child v ON v.child_id = g.child_id
                                                       AND v.educator_person_id = ei.educator_person_id
                       WHERE g.person_id = ei.accepted_by AND g.revoked_at IS NULL) AS shared
         FROM educator_invite ei
        WHERE ei.educator_person_id = $1 AND ei.cancelled_at IS NULL
        ORDER BY ei.created_at DESC
        LIMIT 500`,
      [actor.personId],
    );
    const now = Date.now();
    const invites = rows.map((r) => {
      const state: InviteState = r.accepted_at ? 'joined' : r.expires_at.getTime() <= now ? 'expired' : 'waiting';
      return {
        id: r.id,
        phone: r.phone,
        state,
        shared: r.shared,
        sentAt: r.created_at,
        expiresAt: r.expires_at,
        joinedAt: r.accepted_at,
        remindedAt: r.last_reminded_at,
      };
    });
    const remindable = invites.filter((i) => i.state === 'waiting' && this.canRemind(i.sentAt, i.remindedAt));
    const waiting = invites.filter((i) => i.state === 'waiting');
    const nextRemindAt = waiting.length && !remindable.length
      ? new Date(Math.min(...waiting.map((i) => (i.remindedAt ?? i.sentAt).getTime())) + REMIND_EVERY_DAYS * 86400_000)
      : null;
    return {
      counts: {
        sent: invites.length,
        joined: invites.filter((i) => i.state === 'joined').length,
        waiting: waiting.length,
        expired: invites.filter((i) => i.state === 'expired').length,
      },
      remind: { eligible: remindable.length, nextAt: nextRemindAt, everyDays: REMIND_EVERY_DAYS },
      invites,
    };
  }

  /** design/10 "Remind those waiting": an SMS again, at most once every 3 days per invite. */
  async remind(actor: Actor) {
    const me = await this.educator(actor);
    const due = await this.db.query<{ id: string; phone_e164: string; code: string }>(
      `UPDATE educator_invite SET last_reminded_at = now()
        WHERE educator_person_id = $1 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > now()
          AND COALESCE(last_reminded_at, created_at) <= now() - make_interval(days => $2)
        RETURNING id, phone_e164, code`,
      [actor.personId, REMIND_EVERY_DAYS],
    );
    for (const inv of due) await this.sms(inv.phone_e164, me, inv.code);
    if (due.length) {
      await this.audit.write({ action: 'educator.invites_reminded', personId: actor.personId, payload: { count: due.length } });
    }
    return { reminded: due.length };
  }

  /** design/10 "Resend" on an expired invite: a fresh code, a fresh 14 days. */
  async resend(actor: Actor, inviteId: string) {
    const me = await this.educator(actor);
    const code = await this.db.transaction(async (client) => {
      const old = await client.query<{ phone_e164: string }>(
        `UPDATE educator_invite SET cancelled_at = now()
          WHERE id = $1 AND educator_person_id = $2 AND accepted_at IS NULL AND cancelled_at IS NULL
            AND expires_at <= now()
          RETURNING phone_e164`,
        [inviteId, actor.personId],
      );
      if (!old.rowCount) return null;
      const fresh = randomCode(8);
      await client.query(
        `INSERT INTO educator_invite (educator_person_id, phone_e164, code, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
        [actor.personId, old.rows[0].phone_e164, fresh, INVITE_TTL_DAYS],
      );
      return { code: fresh, phone: old.rows[0].phone_e164 };
    });
    if (!code) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.sms(code.phone, me, code.code);
    await this.audit.write({ action: 'educator.invites_sent', personId: actor.personId, payload: { count: 1, resent: true } });
    return { ok: true };
  }

  /**
   * `/invite/[code]` before sign-in: who invited you. The SMS already said
   * the educator's name, so this reveals nothing new — and nothing at all for
   * an expired, used or unknown code.
   */
  async publicPreview(code: string) {
    const row = await this.db.one<{ educator_name: string; public_code: string; expires_at: Date }>(
      `SELECT p.full_name AS educator_name, ep.public_code, ei.expires_at
         FROM educator_invite ei
         JOIN educator_profile ep ON ep.person_id = ei.educator_person_id AND ep.status = 'approved'
         JOIN person p ON p.id = ei.educator_person_id
        WHERE ei.code = $1 AND ei.cancelled_at IS NULL AND ei.accepted_at IS NULL AND ei.expires_at > now()`,
      [code],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    return { educatorName: row.educator_name, publicCode: row.public_code, expiresAt: row.expires_at };
  }

  private canRemind(sentAt: Date, remindedAt: Date | null): boolean {
    return (remindedAt ?? sentAt).getTime() <= Date.now() - REMIND_EVERY_DAYS * 86400_000;
  }

  private async sms(phone: string, me: { name: string; code: string }, inviteCode: string) {
    await this.notify.queue({
      phone,
      channel: 'sms',
      template: 'educator_invite',
      vars: { educator: me.name, code: me.code, link: `${this.config.webOrigin}/uz/invite/${inviteCode}` },
    });
  }

  private async educator(actor: Actor) {
    const row = await this.db.one<{ name: string; code: string; phone: string }>(
      `SELECT p.full_name AS name, ep.public_code AS code, p.phone
         FROM educator_profile ep JOIN person p ON p.id = ep.person_id WHERE ep.person_id = $1`,
      [actor.personId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    return row;
  }

  // ======================================================== match-check

  async limits(actor: Actor) {
    const [used, misses, pauseTtl] = await Promise.all([
      this.redis.client.get(keys.day(actor.personId)),
      this.redis.client.get(keys.misses(actor.personId)),
      this.redis.client.ttl(keys.pause(actor.personId)),
    ]);
    return {
      used: Number(used ?? 0),
      limit: MATCH_DAILY_LIMIT,
      missesInRow: Number(misses ?? 0),
      missesBeforePause: MATCH_MISSES_BEFORE_PAUSE,
      pausedUntil: pauseTtl > 0 ? new Date(Date.now() + pauseTtl * 1000).toISOString() : null,
      resetsAt: nextTashkentMidnight(),
    };
  }

  /**
   * § 8.4.2: PINFL + family name → match / no match, nothing else. There is
   * no search by PINFL alone, and the answer never says WHICH half was wrong.
   * Every check is logged (hashed, INV-06); the limits live in Redis.
   */
  async matchCheck(actor: Actor, pinfl: string, familyName: string, ip: string | null) {
    if (!PinflService.isWellFormed(pinfl)) throw new BadRequestException({ error: 'PINFL_INVALID' });
    const probe = normaliseFamilyName(familyName);
    if (!probe) throw new BadRequestException({ error: 'FAMILY_NAME_REQUIRED' });

    const limits = await this.limits(actor);
    if (limits.pausedUntil) {
      throw new HttpException({ error: 'MATCH_CHECK_PAUSED', details: { until: limits.pausedUntil } }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const within = await this.redis.rateLimit(keys.day(actor.personId), MATCH_DAILY_LIMIT, 26 * 3600);
    if (!within) {
      throw new HttpException({ error: 'MATCH_CHECK_LIMIT', details: { resetsAt: limits.resetsAt } }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const hash = this.pinfl.hash(pinfl);
    const candidates = await this.db.query<{ id: string; family_name: string; given_name: string }>(
      `SELECT id, family_name, given_name FROM child WHERE pinfl_hash = $1 AND anonymised_at IS NULL`,
      [hash],
    );
    const child = candidates.find((c) => normaliseFamilyName(c.family_name) === probe) ?? null;

    await this.db.query(
      `INSERT INTO pinfl_check_log (educator_person_id, pinfl_hash, family_name_probe, matched, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor.personId, hash, probe.slice(0, 80), !!child, ip],
    );
    await this.audit.write({ action: 'educator.match_check', personId: actor.personId, payload: { matched: !!child } });

    if (!child) {
      const misses = await this.redis.client.incr(keys.misses(actor.personId));
      await this.redis.client.expire(keys.misses(actor.personId), 24 * 3600);
      if (misses >= MATCH_MISSES_BEFORE_PAUSE) {
        await this.redis.client.set(keys.pause(actor.personId), '1', 'EX', MATCH_PAUSE_SEC);
        await this.redis.client.del(keys.misses(actor.personId));
      }
      return { match: false, limits: await this.limits(actor) };
    }

    await this.redis.client.del(keys.misses(actor.personId));
    const token = randomBytes(24).toString('base64url');
    await this.redis.client.set(
      keys.token(token),
      JSON.stringify({ educatorId: actor.personId, childId: child.id }),
      'EX',
      MATCH_TOKEN_TTL_SEC,
    );
    const link = await this.db.one<{ status: string }>(
      `SELECT status::text FROM educator_link
        WHERE educator_person_id = $1 AND child_id = $2
        ORDER BY requested_at DESC LIMIT 1`,
      [actor.personId, child.id],
    );
    return {
      match: true,
      maskedName: maskedName(child.family_name, child.given_name),
      matchToken: token,
      // The educator's OWN link to this child, so the screen can say "you
      // already have access" instead of offering a request that would fail.
      existingLink: link?.status ?? null,
      limits: await this.limits(actor),
    };
  }

  /**
   * One live request per (educator, child) — the partial unique index — and a
   * decline blocks the pair for the season (M2-g). The request lives 14 days.
   */
  async requestAccess(actor: Actor, matchToken: string) {
    const raw = await this.redis.client.getdel(keys.token(matchToken));
    const token = raw ? (JSON.parse(raw) as { educatorId: string; childId: string }) : null;
    if (!token || token.educatorId !== actor.personId) throw new NotFoundException({ error: 'MATCH_TOKEN_INVALID' });

    const season = await this.seasons.current();
    const prior = await this.db.one<{ status: string; same_season: boolean }>(
      `SELECT status::text, (season_id IS NOT DISTINCT FROM $3) AS same_season
         FROM educator_link
        WHERE educator_person_id = $1 AND child_id = $2
          AND (status IN ('requested', 'active', 'suspended') OR status = 'declined')
        ORDER BY (status <> 'declined') DESC, requested_at DESC LIMIT 1`,
      [actor.personId, token.childId, season?.id ?? null],
    );
    if (prior && prior.status !== 'declined') throw new ConflictException({ error: 'LINK_EXISTS', details: { status: prior.status } });
    if (prior?.status === 'declined' && prior.same_season) throw new ConflictException({ error: 'DECLINED_THIS_SEASON' });

    const validUntil = season?.schoolYearEnd ?? new Date(Date.now() + 300 * 86400_000).toISOString().slice(0, 10);
    let linkId: string;
    try {
      const row = await this.db.one<{ id: string; requested_at: Date }>(
        `INSERT INTO educator_link (educator_person_id, child_id, status, valid_until, season_id)
         VALUES ($1, $2, 'requested', ($3::date + interval '1 day' - interval '1 second') AT TIME ZONE 'Asia/Tashkent', $4)
         RETURNING id, requested_at`,
        [actor.personId, token.childId, validUntil, season?.id ?? null],
      );
      linkId = row!.id;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'LINK_EXISTS', details: { status: 'requested' } });
      throw err;
    }

    const who = await this.db.one<{ educator: string; child: string; owner_id: string }>(
      `SELECT p.full_name AS educator, c.given_name AS child, g.person_id AS owner_id
         FROM person p, child c JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE p.id = $1 AND c.id = $2`,
      [actor.personId, token.childId],
    );
    if (who) {
      await this.notify.queue({
        personId: who.owner_id,
        template: 'access_requested',
        vars: {
          educator: who.educator,
          child: who.child,
          expires: new Date(Date.now() + REQUEST_TTL_DAYS * 86400_000).toISOString().slice(0, 10),
          link: `${this.config.webOrigin}/uz/family/access`,
        },
      });
    }
    await this.audit.write({ action: 'access.requested', personId: actor.personId, payload: { linkId, childId: token.childId } });
    return { linkId, status: 'requested', expiresAt: new Date(Date.now() + REQUEST_TTL_DAYS * 86400_000).toISOString() };
  }

  /**
   * The job: a request nobody answered in 14 days is EXPIRED, which frees the
   * one-live-request slot for a new one (M2's access page already shows it as
   * lapsed; this makes the row agree).
   */
  async expireLapsedRequests(): Promise<number> {
    const rows = await this.db.query(
      `UPDATE educator_link SET status = 'expired'
        WHERE status = 'requested' AND requested_at < now() - make_interval(days => $1)
        RETURNING id`,
      [REQUEST_TTL_DAYS],
    );
    return rows.length;
  }
}
