import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { toE164 } from '../common/phone.util';
import { Actor, ActorService, STAFF_ROLES, StaffRole } from '../authz';
import { LoginRequestService } from '../auth/login-request.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 6)}•••••${p.slice(-2)}` : null);
const maskChild = (given: string, family: string) => {
  const g = given.trim();
  return `${family.trim().toUpperCase()} ${g.length <= 2 ? `${g[0] ?? ''}***` : `${g[0]}***${g[g.length - 1]}`}`.toUpperCase();
};

/**
 * § 8.5 Support and Super admin.
 *
 *   support      — looks a person up by phone: relationships, statuses,
 *                  invites and login state; resends an invite; cancels a stuck
 *                  login request. Never a PINFL, never an answer.
 *   super_admin  — staff role assignments and the audit log viewer.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly actors: ActorService,
    private readonly logins: LoginRequestService,
  ) {}

  // ============================================================ support

  async lookup(actor: Actor, rawPhone: string) {
    const phone = toE164(rawPhone);
    if (!phone) throw new BadRequestException({ error: 'PHONE_INVALID' });
    const p = await this.db.one<{ id: string; full_name: string; phone: string; locale: string; created_at: Date; verified_via: string | null; phone_verified_at: Date | null }>(
      `SELECT id, full_name, phone, locale, created_at, verified_via, phone_verified_at FROM person WHERE phone = $1`,
      [phone],
    );
    await this.audit.write({ action: 'support.person_looked_up', personId: actor.personId, payload: { found: !!p, phoneMasked: maskPhone(phone) } });

    // Even with no person: invites waiting for this number and a login in progress.
    const guardianInvitesIn = await this.db.query<{ id: string; kind: string; given_name: string; family_name: string; inviter: string; expires_at: Date; accepted_at: Date | null; cancelled_at: Date | null }>(
      `SELECT gi.id, gi.kind, c.given_name, c.family_name, ip.full_name AS inviter, gi.expires_at, gi.accepted_at, gi.cancelled_at
         FROM guardian_invite gi JOIN child c ON c.id = gi.child_id JOIN person ip ON ip.id = gi.invited_by
        WHERE gi.phone_e164 = $1 ORDER BY gi.expires_at DESC LIMIT 20`,
      [phone],
    );
    const educatorInvitesIn = await this.db.query<{ id: string; educator: string; created_at: Date; expires_at: Date; accepted_at: Date | null; cancelled_at: Date | null }>(
      `SELECT ei.id, p.full_name AS educator, ei.created_at, ei.expires_at, ei.accepted_at, ei.cancelled_at
         FROM educator_invite ei JOIN person p ON p.id = ei.educator_person_id
        WHERE ei.phone_e164 = $1 ORDER BY ei.created_at DESC LIMIT 20`,
      [phone],
    );
    const logins = await this.loginRequests(phone);
    const lock = await this.redis.client.ttl(`rl:start:phone:${phone}`);
    const inviteState = (r: { accepted_at: Date | null; cancelled_at: Date | null; expires_at: Date }) =>
      r.accepted_at ? 'accepted' : r.cancelled_at ? 'cancelled' : r.expires_at.getTime() <= Date.now() ? 'expired' : 'waiting';

    const base = {
      phone,
      invitesForThisPhone: {
        guardian: guardianInvitesIn.map((g) => ({ id: g.id, kind: g.kind, child: maskChild(g.given_name, g.family_name), from: g.inviter, expiresAt: g.expires_at, state: inviteState(g) })),
        educator: educatorInvitesIn.map((e) => ({ id: e.id, educator: e.educator, sentAt: e.created_at, expiresAt: e.expires_at, state: inviteState(e) })),
      },
      login: { requests: logins, startLimitedForSec: lock > 0 ? lock : 0 },
    };
    if (!p) return { found: false, ...base };

    const guardianships = await this.db.query<{ child_id: string; given_name: string; family_name: string; role: string; granted_at: Date; revoked_at: Date | null; grade: number | null }>(
      `SELECT g.child_id, c.given_name, c.family_name, g.role::text, g.granted_at, g.revoked_at,
              (SELECT grade FROM enrolment WHERE child_id = c.id AND ended_at IS NULL ORDER BY school_year DESC LIMIT 1) AS grade
         FROM guardianship g JOIN child c ON c.id = g.child_id WHERE g.person_id = $1 ORDER BY g.revoked_at NULLS FIRST, g.granted_at DESC LIMIT 50`,
      [p.id],
    );
    const educator = await this.db.one(
      `SELECT ep.status::text AS status, ep.kind::text AS kind, ep.public_code AS "publicCode",
              (SELECT count(*)::int FROM educator_link el WHERE el.educator_person_id = ep.person_id AND el.status = 'active') AS "activeLinks"
         FROM educator_profile ep WHERE ep.person_id = $1`,
      [p.id],
    );
    const roles = await this.db.query<{ role: string }>(`SELECT role::text FROM staff_role_assignment WHERE person_id = $1 AND revoked_at IS NULL`, [p.id]);
    const sent = await this.db.query<{ id: string; kind: string; phone_e164: string; given_name: string; family_name: string; expires_at: Date; accepted_at: Date | null; cancelled_at: Date | null }>(
      `SELECT gi.id, gi.kind, gi.phone_e164, c.given_name, c.family_name, gi.expires_at, gi.accepted_at, gi.cancelled_at
         FROM guardian_invite gi JOIN child c ON c.id = gi.child_id WHERE gi.invited_by = $1 ORDER BY gi.expires_at DESC LIMIT 20`,
      [p.id],
    );
    const sessions = await this.db.one<{ active: number; last_used: Date | null }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS active, max(last_used_at) AS last_used
         FROM auth_session WHERE person_id = $1`,
      [p.id],
    );
    const telegram = await this.db.one(`SELECT 1 FROM person WHERE id = $1 AND telegram_user_id IS NOT NULL`, [p.id]);
    return {
      found: true,
      ...base,
      person: {
        id: p.id,
        name: p.full_name,
        locale: p.locale,
        createdAt: p.created_at,
        verifiedVia: p.verified_via,
        phoneVerifiedAt: p.phone_verified_at,
        telegramLinked: !!telegram,
      },
      workspaces: {
        family: guardianships.some((g) => !g.revoked_at),
        educator: educator ? (educator as { status: string }).status : null,
        staff: roles.map((r) => r.role),
      },
      guardianships: guardianships.map((g) => ({
        child: maskChild(g.given_name, g.family_name),
        grade: g.grade,
        role: g.role,
        since: g.granted_at,
        revokedAt: g.revoked_at,
      })),
      educator,
      invitesSent: sent.map((g) => ({ id: g.id, kind: g.kind, to: maskPhone(g.phone_e164), child: maskChild(g.given_name, g.family_name), expiresAt: g.expires_at, state: inviteState(g) })),
      sessions: { active: sessions?.active ?? 0, lastUsedAt: sessions?.last_used ?? null },
    };
  }

  /** Resend a live guardian or educator invite to the number it was sent to. Once per invite per day. */
  async resendInvite(actor: Actor, kind: 'guardian' | 'educator', inviteId: string) {
    if (!UUID.test(inviteId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const day = new Date().toISOString().slice(0, 10);
    if (kind === 'guardian') {
      const g = await this.db.one<{ phone_e164: string; kind: string; code: string; child: string; inviter: string }>(
        `SELECT gi.phone_e164, gi.kind, gi.code, c.given_name AS child, p.full_name AS inviter
           FROM guardian_invite gi JOIN child c ON c.id = gi.child_id JOIN person p ON p.id = gi.invited_by
          WHERE gi.id = $1 AND gi.accepted_at IS NULL AND gi.cancelled_at IS NULL AND gi.expires_at > now()`,
        [inviteId],
      );
      if (!g) throw new ConflictException({ error: 'INVITE_NOT_LIVE' });
      const person = await this.db.one<{ id: string; locale: string }>(`SELECT id, locale FROM person WHERE phone = $1`, [g.phone_e164]);
      const sent = await this.notify.queue({
        personId: person?.id ?? null,
        phone: person ? null : g.phone_e164,
        template: g.kind === 'ownership_transfer' ? 'ownership_transfer' : 'co_guardian_invite',
        vars: { inviter: g.inviter, child: g.child, link: `${this.config.webOrigin}/${person?.locale === 'ru' ? 'ru' : 'uz'}/guardian-invite/${g.code}` },
        throttleKey: `support_resend:${inviteId}:${day}`,
      });
      await this.audit.write({ action: 'guardian.invited', personId: actor.personId, payload: { inviteId, resentBySupport: true, sent: !!sent } });
      return { resent: !!sent };
    }
    const e = await this.db.one<{ phone_e164: string; code: string; educator: string; public_code: string }>(
      `SELECT ei.phone_e164, ei.code, p.full_name AS educator, ep.public_code
         FROM educator_invite ei JOIN person p ON p.id = ei.educator_person_id JOIN educator_profile ep ON ep.person_id = p.id
        WHERE ei.id = $1 AND ei.accepted_at IS NULL AND ei.cancelled_at IS NULL AND ei.expires_at > now()`,
      [inviteId],
    );
    if (!e) throw new ConflictException({ error: 'INVITE_NOT_LIVE' });
    const sent = await this.notify.queue({
      phone: e.phone_e164,
      channel: 'sms',
      template: 'educator_invite',
      vars: { educator: e.educator, code: e.public_code, link: `${this.config.webOrigin}/uz/invite/${e.code}` },
      throttleKey: `support_resend:${inviteId}:${day}`,
    });
    await this.audit.write({ action: 'educator.invites_sent', personId: actor.personId, payload: { inviteId, resentBySupport: true, sent: !!sent } });
    return { resent: !!sent };
  }

  /**
   * A stuck sign-in: cancel the login request (the person starts again) and
   * lift the "too many starts" limit for that phone.
   */
  async cancelLogin(actor: Actor, rawPhone: string, requestId: string) {
    const phone = toE164(rawPhone);
    const req = /^lr_[\w-]{10,64}$/.test(requestId) ? await this.logins.find(requestId) : null;
    if (!req || !phone || req.phone !== phone) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.logins.drop(requestId);
    await this.redis.client.del(`rl:start:phone:${phone}`);
    await this.audit.write({ action: 'auth.cancelled', personId: actor.personId, payload: { bySupport: true, phoneMasked: maskPhone(phone) } });
    return { ok: true };
  }

  private async loginRequests(phone: string) {
    const out: { id: string; status: string; createdAt: string; expiresAt: string; codesIssued: number; attempts: number; telegramLinked: boolean }[] = [];
    let cursor = '0';
    let guard = 0;
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', 'login:req:*', 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        if ((await this.redis.client.hget(key, 'phone')) !== phone) continue;
        const r = await this.logins.find(key.slice('login:req:'.length));
        if (r) {
          out.push({
            id: r.id,
            status: r.status,
            createdAt: new Date(r.createdAt).toISOString(),
            expiresAt: new Date(r.expiresAt).toISOString(),
            codesIssued: r.codesIssued,
            attempts: r.attempts,
            telegramLinked: r.tgUserId !== null,
          });
        }
      }
      guard += 1;
    } while (cursor !== '0' && guard < 200);
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  }

  // ======================================================== super admin

  async roles() {
    const rows = await this.db.query<{ person_id: string; full_name: string; phone: string; id: string; role: string; granted_at: Date; granted_by: string | null }>(
      `SELECT p.id AS person_id, p.full_name, p.phone, s.id, s.role::text, s.granted_at, g.full_name AS granted_by
         FROM staff_role_assignment s JOIN person p ON p.id = s.person_id LEFT JOIN person g ON g.id = s.granted_by
        WHERE s.revoked_at IS NULL ORDER BY p.full_name, s.role`,
    );
    const people = new Map<string, { personId: string; name: string; phone: string | null; roles: { assignmentId: string; role: string; grantedAt: Date; grantedBy: string | null }[] }>();
    for (const r of rows) {
      if (!people.has(r.person_id)) people.set(r.person_id, { personId: r.person_id, name: r.full_name, phone: maskPhone(r.phone), roles: [] });
      people.get(r.person_id)!.roles.push({ assignmentId: r.id, role: r.role, grantedAt: r.granted_at, grantedBy: r.granted_by });
    }
    return { roles: STAFF_ROLES, people: [...people.values()] };
  }

  /** Grant a role to a REGISTERED person (they signed in once). */
  async grant(actor: Actor, rawPhone: string, role: StaffRole) {
    const phone = toE164(rawPhone);
    if (!phone) throw new BadRequestException({ error: 'PHONE_INVALID' });
    const p = await this.db.one<{ id: string }>(`SELECT id FROM person WHERE phone = $1`, [phone]);
    if (!p) throw new NotFoundException({ error: 'PERSON_NOT_FOUND' });
    try {
      await this.db.query(`INSERT INTO staff_role_assignment (person_id, role, granted_by) VALUES ($1, $2, $3)`, [p.id, role, actor.personId]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'ALREADY_HAS_ROLE' });
      throw err;
    }
    await this.actors.invalidate(p.id);
    await this.audit.write({ action: 'staff_role.granted', personId: actor.personId, payload: { subjectId: p.id, role } });
    return this.roles();
  }

  /** There is always at least one super admin — the last one cannot be revoked. */
  async revoke(actor: Actor, assignmentId: string) {
    if (!UUID.test(assignmentId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const a = await this.db.one<{ person_id: string; role: string }>(
      `SELECT person_id, role::text FROM staff_role_assignment WHERE id = $1 AND revoked_at IS NULL`,
      [assignmentId],
    );
    if (!a) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (a.role === 'super_admin') {
      const n = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM staff_role_assignment WHERE role = 'super_admin' AND revoked_at IS NULL`);
      if ((n?.n ?? 0) <= 1) throw new ConflictException({ error: 'LAST_SUPER_ADMIN' });
    }
    await this.db.query(`UPDATE staff_role_assignment SET revoked_at = now() WHERE id = $1`, [assignmentId]);
    await this.actors.invalidate(a.person_id);
    await this.audit.write({ action: 'staff_role.revoked', personId: actor.personId, payload: { subjectId: a.person_id, role: a.role } });
    return this.roles();
  }

  /**
   * The audit log, newest first, keyset-paged (`before` = the last id seen).
   * Payloads were scrubbed when written (no secrets, no PINFL); the person is
   * shown with a masked phone.
   */
  async auditLog(q: { action?: string; phone?: string; from?: string; to?: string; before?: number; limit?: number }) {
    const phone = q.phone ? toE164(q.phone) : null;
    if (q.phone && !phone) throw new BadRequestException({ error: 'PHONE_INVALID' });
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const rows = await this.db.query<{ id: string; created_at: Date; action: string; payload: unknown; ip: string | null; user_agent: string | null; name: string | null; phone: string | null }>(
      `SELECT a.id, a.created_at, a.action, a.payload, host(a.ip) AS ip, a.user_agent, p.full_name AS name, p.phone
         FROM audit_log a LEFT JOIN person p ON p.id = a.person_id
        WHERE ($1::text IS NULL OR a.action = $1 OR a.action LIKE $1 || '.%')
          AND ($2::text IS NULL OR p.phone = $2)
          AND ($3::timestamptz IS NULL OR a.created_at >= $3)
          AND ($4::timestamptz IS NULL OR a.created_at < $4)
          AND ($5::bigint IS NULL OR a.id < $5)
        ORDER BY a.id DESC LIMIT $6`,
      [q.action || null, phone, q.from || null, q.to || null, q.before ?? null, limit],
    );
    return {
      entries: rows.map((r) => ({
        id: Number(r.id),
        at: r.created_at,
        action: r.action,
        person: r.name ? { name: r.name, phone: maskPhone(r.phone) } : null,
        payload: r.payload,
        ip: r.ip,
        userAgent: r.user_agent?.slice(0, 160) ?? null,
      })),
      nextBefore: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
    };
  }

  async auditActions() {
    const rows = await this.db.query<{ action: string; n: number }>(
      `SELECT action, count(*)::int AS n FROM audit_log GROUP BY action ORDER BY action`,
    );
    return rows;
  }
}
