import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor, ActorService } from '../authz';
import { CaseKind, CaseStatus } from './cases.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PREFIX: Record<CaseKind, string> = { ownership_dispute: 'D', fifth_child: 'F', educator_application: 'E', fraud_flag: 'R' };
export const reference = (kind: CaseKind, id: string) => `${PREFIX[kind]}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** A phone for staff eyes: country code and the last two digits. */
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 6)}•••••${p.slice(-2)}` : null);

/**
 * design/15: "People appear as masked names; devices and networks as short
 * hashes." A person's full name "Dilnoza Karimova" → "KARIMOVA D***A"; a
 * child's "Madina" + "KARIMOVA" → "KARIMOVA M***A".
 */
export function maskName(given: string, family?: string): string {
  let g = given.trim();
  let f = family?.trim() ?? '';
  if (!f) {
    const parts = g.split(/\s+/);
    f = parts.length > 1 ? parts.slice(1).join(' ') : '';
    g = parts[0] ?? '';
  }
  const m = g.length <= 2 ? `${g[0] ?? ''}***` : `${g[0]}***${g[g.length - 1]}`;
  return `${f.toUpperCase()} ${m.toUpperCase()}`.trim();
}

/** A short, stable label for a device or network — enough to match, never the address. */
const shortHash = (v: string) => {
  const h = createHash('sha256').update(v).digest('hex');
  return `${h.slice(0, 4)}·${h.slice(4, 8)}`;
};

type Bucket = 'open' | 'waiting' | 'closed';

/**
 * § 8.5 "Trust & safety — one queue": fraud flags, ownership disputes,
 * fifth-child reviews and educator applications, with assignment, notes and
 * each kind's resolutions.
 *
 *   fraud flag      → suspend the educator's links and ask the owners
 *                     (never block silently) · dismiss with a note ·
 *                     confirm and escalate (M8-b: suspends the educator)
 *   ownership dispute → statements from both sides + staff call notes
 *                     (M8-d) → keep the owner, or a clean handover (M8-c)
 *   fifth child     → approve (the owner may add one more child) · reject
 *   educator application → decided with M6's endpoints; listed here
 *
 * Staff see names and masked phones — never a PINFL (INV-06).
 */
@Injectable()
export class QueueService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly actors: ActorService,
  ) {}

  // ================================================================ list

  async list(actor: Actor, q: { kind?: CaseKind; bucket?: Bucket; mine?: boolean }) {
    const statuses: CaseStatus[] =
      q.bucket === 'waiting' ? ['waiting_owner'] : q.bucket === 'closed' ? ['resolved', 'dismissed'] : ['open', 'waiting_owner'];
    const rows = await this.db.query<{
      id: string;
      kind: CaseKind;
      status: CaseStatus;
      opened_at: Date;
      resolved_at: Date | null;
      resolution: string | null;
      assigned_to: string | null;
      assignee: string | null;
      subject_name: string | null;
      child_name: string | null;
      child_given: string | null;
      child_family: string | null;
      rule: string | null;
      severity: number | null;
      claimant_confirmed: boolean | null;
    }>(
      `SELECT c.id, c.kind::text AS kind, c.status::text AS status, c.opened_at, c.resolved_at, c.resolution,
              c.assigned_to, a.full_name AS assignee, p.full_name AS subject_name,
              ch.given_name || ' ' || initcap(ch.family_name) AS child_name,
              ch.given_name AS child_given, ch.family_name AS child_family,
              f.rule_code AS rule, f.severity, (c.payload->>'claimantConfirmed')::boolean AS claimant_confirmed
         FROM review_case c
    LEFT JOIN person a ON a.id = c.assigned_to
    LEFT JOIN person p ON p.id = c.subject_person_id
    LEFT JOIN child ch ON ch.id = c.subject_child_id
    LEFT JOIN registration_flag f ON f.id = c.registration_flag_id
        WHERE c.status = ANY($1::case_status[])
          AND ($2::case_kind IS NULL OR c.kind = $2)
          AND (NOT $3::boolean OR c.assigned_to = $4)
          -- A dispute the claimant never confirmed is not a dispute yet (M2-d).
          AND NOT (c.kind = 'ownership_dispute' AND COALESCE((c.payload->>'claimantConfirmed')::boolean, false) = false
                   AND c.status IN ('open', 'waiting_owner'))
        ORDER BY CASE WHEN c.status IN ('open', 'waiting_owner') THEN 0 ELSE 1 END,
                 COALESCE(f.severity, 1) DESC, c.opened_at ASC
        LIMIT 300`,
      [statuses, q.kind ?? null, !!q.mine, actor.personId],
    );
    const counts = await this.db.query<{ kind: CaseKind; open: number; waiting: number }>(
      `SELECT kind::text AS kind, count(*) FILTER (WHERE status = 'open')::int AS open,
              count(*) FILTER (WHERE status = 'waiting_owner')::int AS waiting
         FROM review_case
        WHERE status IN ('open', 'waiting_owner')
          AND NOT (kind = 'ownership_dispute' AND COALESCE((payload->>'claimantConfirmed')::boolean, false) = false)
        GROUP BY kind`,
    );
    return {
      counts: Object.fromEntries(counts.map((c) => [c.kind, { open: c.open, waiting: c.waiting }])),
      cases: rows.map((r) => ({
        id: r.id,
        reference: reference(r.kind, r.id),
        kind: r.kind,
        status: r.status,
        openedAt: r.opened_at,
        resolvedAt: r.resolved_at,
        resolution: r.resolution,
        assignee: r.assigned_to ? { personId: r.assigned_to, name: r.assignee, me: r.assigned_to === actor.personId } : null,
        subjectName: r.subject_name ? maskName(r.subject_name) : null,
        childName: r.child_given ? maskName(r.child_given, r.child_family ?? '') : null,
        rule: r.rule,
        severity: r.severity,
      })),
    };
  }

  /** Who a case may be assigned to: holders of `trust_safety`. */
  async staff() {
    return this.db.query(
      `SELECT p.id AS "personId", p.full_name AS name FROM staff_role_assignment s JOIN person p ON p.id = s.person_id
        WHERE s.role = 'trust_safety' AND s.revoked_at IS NULL ORDER BY p.full_name`,
    );
  }

  // ============================================================== detail

  async detail(actor: Actor, caseId: string) {
    const c = await this.case(caseId);
    // A party's statement is signed with their masked name; staff sign as themselves.
    const notes = (
      await this.db.query<{ id: number; authorRole: string; authorName: string; body: string; createdAt: Date }>(
        `SELECT n.id, n.author_role AS "authorRole", p.full_name AS "authorName", n.body, n.created_at AS "createdAt"
           FROM case_note n JOIN person p ON p.id = n.author_id WHERE n.case_id = $1 ORDER BY n.created_at`,
        [caseId],
      )
    ).map((n) => (n.authorRole === 'staff' ? n : { ...n, authorName: maskName(n.authorName) }));
    const base = {
      id: c.id,
      reference: reference(c.kind, c.id),
      kind: c.kind,
      status: c.status,
      openedAt: c.opened_at,
      resolvedAt: c.resolved_at,
      resolution: c.resolution,
      assignee: c.assigned_to ? { personId: c.assigned_to, name: c.assignee, me: c.assigned_to === actor.personId } : null,
      notes,
    };
    if (c.kind === 'fraud_flag') return { ...base, fraud: await this.fraudDetail(c) };
    if (c.kind === 'ownership_dispute') return { ...base, dispute: await this.disputeDetail(c) };
    if (c.kind === 'fifth_child') return { ...base, fifthChild: await this.fifthDetail(c) };
    return { ...base, application: await this.applicationDetail(c) };
  }

  private async fraudDetail(c: CaseRow) {
    const flag = await this.db.one<{ rule_code: string; severity: number; evidence: Record<string, unknown>; created_at: Date; resolution: string | null }>(
      `SELECT rule_code, severity, evidence, created_at, resolution FROM registration_flag WHERE id = $1`,
      [c.registration_flag_id],
    );
    const educatorId = await this.educatorOf(c);
    const educator = educatorId
      ? await this.db.one(
          `SELECT p.id AS "personId", p.full_name AS "fullName", ep.status::text AS status, ep.public_code AS "publicCode",
                  (SELECT count(*)::int FROM educator_link el WHERE el.educator_person_id = p.id AND el.status = 'active') AS "activeLinks"
             FROM person p JOIN educator_profile ep ON ep.person_id = p.id WHERE p.id = $1`,
          [educatorId],
        )
      : null;
    const subject = c.subject_person_id ? await this.person(c.subject_person_id) : null;
    const child = c.subject_child_id ? await this.childSummary(c.subject_child_id) : null;
    const educatorView = educator
      ? (({ fullName, ...rest }: Record<string, unknown>) => ({ ...rest, name: maskName(String(fullName)) }))(educator as Record<string, unknown>)
      : null;
    const links = await this.db.query(
      `SELECT el.id, upper(ch.family_name) || ' ' || upper(left(ch.given_name, 1)) || '***' || upper(right(ch.given_name, 1)) AS "childName", el.status::text AS status,
              el.owner_response AS "ownerResponse", el.owner_responded_at AS "ownerRespondedAt", el.suspended_at AS "suspendedAt"
         FROM educator_link el JOIN child ch ON ch.id = el.child_id
        WHERE el.suspended_case_id = $1 ORDER BY ch.given_name`,
      [c.id],
    );
    // People and children named in the evidence, resolved to names for the reviewer.
    const ev: Record<string, unknown> = { ...(flag?.evidence ?? {}) };
    // Devices and networks as short hashes, never the address (design/15).
    const dev = ev.device as { ip?: string; userAgent?: string } | undefined;
    if (dev?.ip) ev.device = { device: shortHash(`${dev.ip}|${dev.userAgent ?? ''}`), network: shortHash(dev.ip) };
    const people = Array.isArray(ev.personIds) ? await this.names('person', ev.personIds as string[]) : [];
    const kids = Array.isArray(ev.childIds) ? await this.names('child', ev.childIds as string[]) : [];
    return {
      rule: flag?.rule_code ?? null,
      severity: flag?.severity ?? null,
      raisedAt: flag?.created_at ?? null,
      flagResolution: flag?.resolution ?? null,
      evidence: ev,
      evidencePeople: people,
      evidenceChildren: kids,
      subject,
      child,
      educator: educatorView,
      suspendedLinks: links,
      canSuspendLinks: !!educator && c.status === 'open',
    };
  }

  private async disputeDetail(c: CaseRow) {
    const p = c.payload as { claimantPersonId?: string; claimedFamilyName?: string; claimedGivenName?: string; claimantConfirmed?: boolean; currentOwnerPersonId?: string };
    const child = c.subject_child_id ? await this.childSummary(c.subject_child_id) : null;
    const owner = await this.db.one<{ person_id: string }>(
      `SELECT person_id FROM guardianship WHERE child_id = $1 AND role = 'owner' AND revoked_at IS NULL`,
      [c.subject_child_id],
    );
    return {
      child,
      claimant: p.claimantPersonId ? { ...(await this.person(p.claimantPersonId)), claimedName: maskName(p.claimedGivenName ?? '', p.claimedFamilyName ?? '') } : null,
      owner: owner ? await this.person(owner.person_id) : null,
      claimantConfirmed: !!p.claimantConfirmed,
    };
  }

  private async fifthDetail(c: CaseRow) {
    const p = c.payload as { familyName?: string; givenName?: string; grade?: number; alreadyOwns?: number; used?: boolean };
    const children = await this.db.query(
      `SELECT upper(c.family_name) || ' ' || upper(left(c.given_name, 1)) || '***' || upper(right(c.given_name, 1)) AS name,
              e.grade, c.dob, g.granted_at AS "since"
         FROM guardianship g JOIN child c ON c.id = g.child_id
    LEFT JOIN LATERAL (SELECT grade FROM enrolment WHERE child_id = c.id AND ended_at IS NULL ORDER BY school_year DESC LIMIT 1) e ON true
        WHERE g.person_id = $1 AND g.role = 'owner' AND g.revoked_at IS NULL ORDER BY c.dob`,
      [c.subject_person_id],
    );
    return {
      parent: c.subject_person_id ? await this.person(c.subject_person_id) : null,
      requested: { name: maskName(p.givenName ?? '', p.familyName ?? ''), grade: p.grade ?? null },
      alreadyOwns: p.alreadyOwns ?? children.length,
      children,
      used: !!p.used,
    };
  }

  private async applicationDetail(c: CaseRow) {
    return this.db.one(
      `SELECT p.id AS "personId", p.full_name AS name, ep.kind::text AS kind, ep.status::text AS status,
              r.name_uz AS "regionUz", r.name_ru AS "regionRu", s.name AS "schoolName", ep.subjects, ep.applied_at AS "appliedAt"
         FROM educator_profile ep JOIN person p ON p.id = ep.person_id
    LEFT JOIN region r ON r.id = ep.region_id LEFT JOIN school s ON s.id = ep.school_id
        WHERE ep.person_id = $1`,
      [c.subject_person_id],
    );
  }

  // ============================================================ actions

  async assign(actor: Actor, caseId: string, personId: string | null) {
    await this.case(caseId);
    if (personId) {
      const ok = await this.db.one(
        `SELECT 1 FROM staff_role_assignment WHERE person_id = $1 AND role = 'trust_safety' AND revoked_at IS NULL`,
        [personId],
      );
      if (!ok) throw new BadRequestException({ error: 'NOT_TRUST_SAFETY' });
    }
    await this.db.query(`UPDATE review_case SET assigned_to = $2 WHERE id = $1`, [caseId, personId]);
    await this.audit.write({ action: 'case.assigned', personId: actor.personId, payload: { caseId, assignee: personId } });
    return this.detail(actor, caseId);
  }

  async note(actor: Actor, caseId: string, body: string) {
    await this.case(caseId);
    await this.db.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, body.trim()]);
    await this.audit.write({ action: 'case.noted', personId: actor.personId, payload: { caseId } });
    return this.detail(actor, caseId);
  }

  /**
   * § 8.5 "Suspend the educator's links and ask the owners to confirm. Never
   * block silently." Every ACTIVE link of the educator is suspended (the
   * educator loses sight at once — `v_educator_visible_child` excludes it), and
   * each owner is asked; the owner's answer restores or ends the link.
   */
  async suspendLinks(actor: Actor, caseId: string, note: string | null) {
    const c = await this.case(caseId, 'fraud_flag');
    if (c.status !== 'open') throw new ConflictException({ error: 'CASE_NOT_OPEN' });
    const educatorId = await this.educatorOf(c);
    if (!educatorId) throw new ConflictException({ error: 'NO_EDUCATOR' });
    const n = await this.db.transaction(async (client) => {
      const k = await this.suspendEducatorLinks(client, educatorId, caseId, 'Ishonch va xavfsizlik tekshiruvi');
      await client.query(`UPDATE review_case SET status = 'waiting_owner', assigned_to = COALESCE(assigned_to, $2) WHERE id = $1`, [caseId, actor.personId]);
      if (note) await client.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
      return k;
    });
    await this.actors.invalidate(educatorId);
    await this.askOwners(caseId);
    await this.audit.write({ action: 'case.links_suspended', personId: actor.personId, payload: { caseId, educatorId, links: n } });
    return this.detail(actor, caseId);
  }

  /** A false positive: the flag and the case close, with the reason on record. */
  async dismiss(actor: Actor, caseId: string, note: string) {
    const c = await this.case(caseId, 'fraud_flag');
    if (c.status === 'resolved' || c.status === 'dismissed') throw new ConflictException({ error: 'CASE_CLOSED' });
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE registration_flag SET resolved_at = now(), resolved_by = $2, resolution = 'dismissed' WHERE id = $1`,
        [c.registration_flag_id, actor.personId],
      );
      await client.query(`UPDATE review_case SET status = 'dismissed', resolution = 'false_positive', resolved_at = now() WHERE id = $1`, [caseId]);
      await client.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
    });
    await this.audit.write({ action: 'flag.dismissed', personId: actor.personId, payload: { caseId } });
    return this.detail(actor, caseId);
  }

  /**
   * Confirm and escalate (M8-b). With an educator behind the flag: the
   * educator's profile is SUSPENDED (no educator action works) and any link
   * still active is suspended with the owners asked — they keep the choice.
   * Otherwise the case is recorded as confirmed.
   */
  async confirm(actor: Actor, caseId: string, note: string) {
    const c = await this.case(caseId, 'fraud_flag');
    if (c.status === 'resolved' || c.status === 'dismissed') throw new ConflictException({ error: 'CASE_CLOSED' });
    const educatorId = await this.educatorOf(c);
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE registration_flag SET resolved_at = now(), resolved_by = $2, resolution = 'confirmed' WHERE id = $1`,
        [c.registration_flag_id, actor.personId],
      );
      if (educatorId) {
        await client.query(
          `UPDATE educator_profile SET status = 'suspended', decided_by = $2, decided_at = now(), note = $3 WHERE person_id = $1`,
          [educatorId, actor.personId, `Suspended: ${reference('fraud_flag', caseId)}`],
        );
        await this.suspendEducatorLinks(client, educatorId, caseId, 'Ishonch va xavfsizlik qarori');
      }
      await client.query(`UPDATE review_case SET status = 'resolved', resolution = $2, resolved_at = now() WHERE id = $1`, [
        caseId,
        educatorId ? 'confirmed_educator_suspended' : 'confirmed',
      ]);
      await client.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
    });
    if (educatorId) {
      await this.actors.invalidate(educatorId);
      await this.askOwners(caseId);
    }
    await this.audit.write({ action: 'flag.confirmed', personId: actor.personId, payload: { caseId, educatorSuspended: !!educatorId } });
    return this.detail(actor, caseId);
  }

  /** After the owners answered: close the case. The links stay as the owners left them. */
  async close(actor: Actor, caseId: string, note: string | null) {
    const c = await this.case(caseId, 'fraud_flag');
    if (c.status !== 'waiting_owner') throw new ConflictException({ error: 'CASE_NOT_WAITING' });
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE registration_flag SET resolved_at = now(), resolved_by = $2, resolution = 'owners_answered' WHERE id = $1 AND resolved_at IS NULL`,
        [c.registration_flag_id, actor.personId],
      );
      await client.query(`UPDATE review_case SET status = 'resolved', resolution = 'owners_answered', resolved_at = now() WHERE id = $1`, [caseId]);
      if (note) await client.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
    });
    await this.audit.write({ action: 'case.resolved', personId: actor.personId, payload: { caseId, resolution: 'owners_answered' } });
    return this.detail(actor, caseId);
  }

  /** § 8.2: the fifth child goes to a human. Approved → the owner may add one more child. */
  async decideFifth(actor: Actor, caseId: string, decision: 'approved' | 'rejected', note: string | null) {
    const c = await this.case(caseId, 'fifth_child');
    if (c.status !== 'open' && c.status !== 'waiting_owner') throw new ConflictException({ error: 'CASE_CLOSED' });
    await this.db.query(`UPDATE review_case SET status = 'resolved', resolution = $2, resolved_at = now() WHERE id = $1`, [caseId, decision]);
    if (note) await this.db.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
    await this.tell(c.subject_person_id, {
      what: 'Beshinchi farzand', whatRu: 'Пятый ребёнок',
      outcome: decision === 'approved' ? 'tasdiqlandi — farzandni qayta qoʻshishingiz mumkin' : 'tasdiqlanmadi',
      outcomeRu: decision === 'approved' ? 'одобрено — можно снова добавить ребёнка' : 'не одобрено',
      note: decision === 'rejected' ? note : null,
      link: `${this.config.webOrigin}/uz/family/children/new`,
    });
    await this.audit.write({ action: 'case.resolved', personId: actor.personId, payload: { caseId, kind: 'fifth_child', decision } });
    return this.detail(actor, caseId);
  }

  /**
   * An ownership dispute (§ 8.2). `keep`: the owner stays. `transfer` — a clean
   * handover (M8-c): the claimant becomes the owner; the old owner and every
   * co-guardian lose access; open invites and an anonymisation request are
   * cancelled; educator links are suspended until the NEW owner confirms each;
   * consents end and must be given again by the new owner (measurement pauses).
   * Both parties are told.
   */
  async decideDispute(actor: Actor, caseId: string, decision: 'keep' | 'transfer', note: string) {
    const c = await this.case(caseId, 'ownership_dispute');
    if (c.status !== 'open' && c.status !== 'waiting_owner') throw new ConflictException({ error: 'CASE_CLOSED' });
    const p = c.payload as { claimantPersonId?: string; claimantConfirmed?: boolean };
    if (!p.claimantConfirmed) throw new ConflictException({ error: 'CLAIM_NOT_CONFIRMED' });
    const childId = c.subject_child_id!;
    const claimant = p.claimantPersonId!;
    const before = await this.db.query<{ person_id: string; role: string }>(
      `SELECT person_id, role::text FROM guardianship WHERE child_id = $1 AND revoked_at IS NULL`,
      [childId],
    );
    const oldOwner = before.find((g) => g.role === 'owner')?.person_id ?? null;
    if (decision === 'transfer' && before.some((g) => g.person_id === claimant && g.role === 'owner')) {
      throw new ConflictException({ error: 'ALREADY_OWNER' });
    }

    await this.db.transaction(async (client) => {
      if (decision === 'transfer') {
        await client.query(`UPDATE guardianship SET revoked_at = now() WHERE child_id = $1 AND revoked_at IS NULL`, [childId]);
        await client.query(
          `INSERT INTO guardianship (child_id, person_id, role, granted_by) VALUES ($1, $2, 'owner', $3)`,
          [childId, claimant, actor.personId],
        );
        await client.query(`UPDATE guardian_invite SET cancelled_at = now() WHERE child_id = $1 AND accepted_at IS NULL AND cancelled_at IS NULL`, [childId]);
        await client.query(
          `UPDATE anonymisation_request SET cancelled_at = now() WHERE child_id = $1 AND executed_at IS NULL AND cancelled_at IS NULL`,
          [childId],
        );
        await client.query(`UPDATE consent SET revoked_at = now() WHERE child_id = $1 AND revoked_at IS NULL`, [childId]);
        await client.query(
          `UPDATE educator_link SET status = 'suspended', suspended_at = now(), suspended_reason = 'Egalik oʻzgardi',
                  suspended_case_id = $2, owner_response = NULL, owner_responded_at = NULL
            WHERE child_id = $1 AND status = 'active'`,
          [childId, caseId],
        );
      }
      await client.query(`UPDATE review_case SET status = 'resolved', resolution = $2, resolved_at = now() WHERE id = $1`, [
        caseId,
        decision === 'transfer' ? 'transferred' : 'kept',
      ]);
      await client.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, 'staff', $3)`, [caseId, actor.personId, note]);
    });

    await this.actors.invalidate(claimant, ...before.map((g) => g.person_id));
    const link = `${this.config.webOrigin}/uz/family/disputes/${caseId}`;
    const ref = reference('ownership_dispute', caseId);
    await this.tell(claimant, {
      what: `Egalik nizosi ${ref}`, whatRu: `Спор о владении ${ref}`,
      outcome: decision === 'transfer' ? 'profil sizga oʻtkazildi — rozilik va ruxsatlarni tasdiqlang' : 'profil hozirgi egasida qoldi',
      outcomeRu: decision === 'transfer' ? 'профиль передан вам — подтвердите согласия и доступы' : 'профиль остаётся у текущего владельца',
      note: null,
      link,
    });
    await this.tell(oldOwner, {
      what: `Egalik nizosi ${ref}`, whatRu: `Спор о владении ${ref}`,
      outcome: decision === 'transfer' ? 'profil boshqa ota-onaga oʻtkazildi' : 'profil sizda qoldi',
      outcomeRu: decision === 'transfer' ? 'профиль передан другому родителю' : 'профиль остаётся у вас',
      note: null,
      link,
    });
    await this.audit.write({
      action: decision === 'transfer' ? 'ownership.transferred' : 'case.resolved',
      personId: actor.personId,
      payload: { caseId, childId, decision },
    });
    return this.detail(actor, caseId);
  }

  // ======================================================== family side

  /** The parent's disputes: as the claimant, or as the owner of the claimed child. */
  async familyDisputes(actor: Actor) {
    const rows = await this.db.query<{ id: string; status: string; resolution: string | null; opened_at: Date; resolved_at: Date | null; role: 'claimant' | 'owner'; child_name: string; my_child: string | null }>(
      `SELECT c.id, c.status::text, c.resolution, c.opened_at, c.resolved_at,
              -- The child's id only to someone who holds the child NOW (the
              -- claimant after a transfer, the owner otherwise).
              (SELECT g.child_id FROM guardianship g WHERE g.child_id = c.subject_child_id AND g.person_id = $1::uuid
                  AND g.revoked_at IS NULL LIMIT 1) AS my_child,
              CASE WHEN c.payload->>'claimantPersonId' = $1::text THEN 'claimant' ELSE 'owner' END AS role,
              CASE WHEN c.payload->>'claimantPersonId' = $1::text
                   THEN trim(COALESCE(c.payload->>'claimedGivenName', '') || ' ' || COALESCE(c.payload->>'claimedFamilyName', ''))
                   ELSE ch.given_name || ' ' || initcap(ch.family_name) END AS child_name
         FROM review_case c JOIN child ch ON ch.id = c.subject_child_id
        WHERE c.kind = 'ownership_dispute' AND COALESCE((c.payload->>'claimantConfirmed')::boolean, false)
          AND (c.payload->>'claimantPersonId' = $1::text
               OR EXISTS (SELECT 1 FROM guardianship g WHERE g.child_id = c.subject_child_id AND g.person_id = $1::uuid
                           AND g.role = 'owner' AND (g.revoked_at IS NULL OR g.revoked_at >= c.opened_at)))
        ORDER BY c.opened_at DESC`,
      [actor.personId],
    );
    return rows.map((r) => ({
      id: r.id,
      reference: reference('ownership_dispute', r.id),
      role: r.role,
      childName: r.child_name,
      childId: r.my_child,
      status: r.status,
      outcome: r.resolution,
      openedAt: r.opened_at,
      resolvedAt: r.resolved_at,
    }));
  }

  /**
   * One dispute as a party sees it: the status, the outcome, and THEIR OWN
   * statements — never the other side's identity or words (M2: the claimant
   * learns only that a profile exists).
   */
  async familyDispute(actor: Actor, caseId: string) {
    const d = (await this.familyDisputes(actor)).find((x) => x.id === caseId);
    if (!d) throw new NotFoundException({ error: 'NOT_FOUND' });
    const mine = await this.db.query(
      `SELECT id, body, created_at AS "createdAt" FROM case_note WHERE case_id = $1 AND author_id = $2 AND author_role <> 'staff' ORDER BY created_at`,
      [caseId, actor.personId],
    );
    return { ...d, statements: mine, canWrite: d.status === 'open' || d.status === 'waiting_owner' };
  }

  async addStatement(actor: Actor, caseId: string, body: string) {
    const d = await this.familyDispute(actor, caseId);
    if (!d.canWrite) throw new ConflictException({ error: 'CASE_CLOSED' });
    const count = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM case_note WHERE case_id = $1 AND author_id = $2`, [caseId, actor.personId]);
    if ((count?.n ?? 0) >= 10) throw new ConflictException({ error: 'TOO_MANY_STATEMENTS' });
    await this.db.query(`INSERT INTO case_note (case_id, author_id, author_role, body) VALUES ($1, $2, $3, $4)`, [caseId, actor.personId, d.role, body.trim()]);
    await this.audit.write({ action: 'case.noted', personId: actor.personId, payload: { caseId, role: d.role } });
    return this.familyDispute(actor, caseId);
  }

  /**
   * The owner's answer to "a check suspended this access — do you confirm?".
   * keep → the link is active again (it still shows nothing if the educator
   * itself is suspended); revoke → it ends.
   */
  async ownerAnswer(actor: Actor, childId: string, linkId: string, keep: boolean) {
    if (!UUID.test(linkId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const row = await this.db.one<{ id: string; suspended_case_id: string | null }>(
      `UPDATE educator_link SET
          status = CASE WHEN $3 THEN 'active'::educator_link_status ELSE 'revoked'::educator_link_status END,
          suspended_at = NULL, revoked_at = CASE WHEN $3 THEN revoked_at ELSE now() END,
          owner_response = CASE WHEN $3 THEN 'kept' ELSE 'revoked' END, owner_responded_at = now(),
          decided_by = $4, decided_at = now()
        WHERE id = $1 AND child_id = $2 AND status = 'suspended' AND suspended_case_id IS NOT NULL
        RETURNING id, suspended_case_id`,
      [linkId, childId, keep, actor.personId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    const edu = await this.db.one<{ educator_person_id: string }>(`SELECT educator_person_id FROM educator_link WHERE id = $1`, [linkId]);
    if (edu) await this.actors.invalidate(edu.educator_person_id);
    await this.audit.write({ action: 'access.owner_answered', personId: actor.personId, payload: { linkId, childId, keep, caseId: row.suspended_case_id } });
    return { ok: true, status: keep ? 'active' : 'revoked' };
  }

  // ============================================================= helpers

  private async suspendEducatorLinks(client: PoolClient, educatorId: string, caseId: string, reason: string): Promise<number> {
    const r = await client.query(
      `UPDATE educator_link SET status = 'suspended', suspended_at = now(), suspended_reason = $3, suspended_case_id = $2,
              owner_response = NULL, owner_responded_at = NULL
        WHERE educator_person_id = $1 AND status = 'active' AND NOT is_own_child`,
      [educatorId, caseId, reason],
    );
    return r.rowCount ?? 0;
  }

  /** `case_needs_owner_confirmation` to each owner whose link this case suspended — once per child. */
  private async askOwners(caseId: string) {
    const owners = await this.db.query<{ owner_id: string; child: string; child_id: string }>(
      `SELECT DISTINCT g.person_id AS owner_id, c.given_name AS child, c.id AS child_id
         FROM educator_link el JOIN child c ON c.id = el.child_id
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE el.suspended_case_id = $1 AND el.owner_response IS NULL`,
      [caseId],
    );
    for (const o of owners) {
      await this.notify.queue({
        personId: o.owner_id,
        template: 'case_needs_owner_confirmation',
        vars: {
          child: o.child,
          reason: 'Ustoz ruxsatini tekshiruv vaqtida toʻxtatdik. Ruxsatni saqlaysizmi yoki bekor qilasizmi?',
          link: `${this.config.webOrigin}/uz/family/access`,
        },
        throttleKey: `owner_confirm:${caseId}:${o.child_id}`,
      });
    }
  }

  private async tell(personId: string | null, vars: Record<string, string | null>) {
    if (!personId) return;
    await this.notify.queue({
      personId,
      template: 'case_decided',
      vars: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v ?? ''])),
    });
  }

  /** The educator behind a fraud case: the subject when it is an educator, else the evidence's educatorId. */
  private async educatorOf(c: CaseRow): Promise<string | null> {
    if (c.subject_person_id) {
      const e = await this.db.one(`SELECT 1 FROM educator_profile WHERE person_id = $1 AND status IN ('approved', 'suspended')`, [c.subject_person_id]);
      if (e) return c.subject_person_id;
    }
    const fromPayload = (c.payload as { educatorId?: string | null }).educatorId;
    return fromPayload && UUID.test(fromPayload) ? fromPayload : null;
  }

  private async person(id: string) {
    const p = await this.db.one<{ id: string; full_name: string; phone: string }>(`SELECT id, full_name, phone FROM person WHERE id = $1`, [id]);
    return p ? { personId: p.id, name: maskName(p.full_name), phone: maskPhone(p.phone) } : null;
  }

  private async childSummary(id: string) {
    return this.db.one(
      `SELECT c.id, upper(c.family_name) || ' ' || upper(left(c.given_name, 1)) || '***' || upper(right(c.given_name, 1)) AS name,
              c.dob, e.grade
         FROM child c LEFT JOIN LATERAL (SELECT grade FROM enrolment WHERE child_id = c.id AND ended_at IS NULL
                                          ORDER BY school_year DESC LIMIT 1) e ON true
        WHERE c.id = $1`,
      [id],
    );
  }

  private async names(kind: 'person' | 'child', ids: string[]) {
    const valid = ids.filter((i) => UUID.test(i));
    if (!valid.length) return [];
    return kind === 'person'
      ? (await this.db.query<{ id: string; name: string }>(`SELECT id, full_name AS name FROM person WHERE id = ANY($1::uuid[])`, [valid])).map(
          (r) => ({ id: r.id, name: maskName(r.name) }),
        )
      : (await this.db.query<{ id: string; given: string; family: string }>(
          `SELECT id, given_name AS given, family_name AS family FROM child WHERE id = ANY($1::uuid[])`,
          [valid],
        )).map((r) => ({ id: r.id, name: maskName(r.given, r.family) }));
  }

  private async case(id: string, kind?: CaseKind): Promise<CaseRow> {
    if (!UUID.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const c = await this.db.one<CaseRow>(
      `SELECT c.id, c.kind::text AS kind, c.status::text AS status, c.subject_person_id, c.subject_child_id,
              c.registration_flag_id, c.payload, c.assigned_to, a.full_name AS assignee, c.resolution, c.opened_at, c.resolved_at
         FROM review_case c LEFT JOIN person a ON a.id = c.assigned_to WHERE c.id = $1`,
      [id],
    );
    if (!c || (kind && c.kind !== kind)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return c;
  }
}

interface CaseRow {
  id: string;
  kind: CaseKind;
  status: CaseStatus;
  subject_person_id: string | null;
  subject_child_id: string | null;
  registration_flag_id: string | null;
  payload: Record<string, unknown>;
  assigned_to: string | null;
  assignee: string | null;
  resolution: string | null;
  opened_at: Date;
  resolved_at: Date | null;
}
