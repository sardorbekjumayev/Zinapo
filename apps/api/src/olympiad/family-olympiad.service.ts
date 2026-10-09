import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor } from '../authz';
import { clusterStanding } from '../measurement/measurement.math';
import {
  IN_PERSON_STAGES,
  ONLINE_STAGES,
  StageKind,
  TICKET_WAVES,
  UUID,
  registrationOpen,
  stageState,
} from './olympiad.common';

interface StageRow {
  id: string;
  olympiad_id: string;
  kind: StageKind;
  opens_at: Date;
  closes_at: Date;
  registration_closes_at: Date | null;
  results_published_at: Date | null;
  has_form: boolean;
}

interface EntryRow {
  id: string;
  stage_id: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_starts_at: Date | null;
  entry_via: string | null;
  registered_at: Date;
  checked_in_at: Date | null;
  session_id: string | null;
  session_status: string | null;
  result_rank: number | null;
  result_pct_low: number | null;
  result_pct_high: number | null;
  result_cohort_n: number | null;
  certificate: boolean;
  qualified: boolean;
}

export type Eligibility =
  | 'ok'
  | 'registered'
  | 'grade'
  | 'closed'
  | 'needs_ticket_or_qualification'
  | 'needs_invitation'
  | 'no_form';

/**
 * § 8.1.6 — the parent's olympiad: the stages, the ticket (≥ 3 monitoring
 * waves = direct entry to the spring final), registration at a venue, the
 * online stages in kid mode, and the results once published — a band, a
 * certificate only for the top 15 %, a diagnostic for everyone. Grades 0–2:
 * a marathon with no places.
 *
 * Results are the family's alone ("no public tables or lists of names — ever").
 */
@Injectable()
export class FamilyOlympiadService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async overview(childId: string) {
    const child = await this.child(childId);
    const olympiads = await this.db.query<{
      id: string;
      slug: string;
      title_uz: string;
      title_ru: string;
      grade_min: number;
      grade_max: number;
      is_ranked: boolean;
      certificate_top_pct: number;
      qualify_top_pct: number;
    }>(
      `SELECT o.id, o.slug, o.title_uz, o.title_ru, o.grade_min, o.grade_max, o.is_ranked,
              o.certificate_top_pct, o.qualify_top_pct
         FROM olympiad o JOIN season s ON s.id = o.season_id AND s.is_current
        WHERE $1::smallint BETWEEN o.grade_min AND o.grade_max
        ORDER BY o.created_at`,
      [child.grade],
    );
    const ticket = await this.ticket(childId);
    const out = [];
    for (const o of olympiads) {
      const stages = await this.stages(o.id, child.grade);
      const entries = await this.entries(childId, o.id);
      const awards = await this.db.query<{ kind: string; place: number | null; stage_id: string | null }>(
        `SELECT kind::text, place, stage_id FROM olympiad_award
          WHERE olympiad_id = $1 AND child_id = $2
            AND (stage_id IS NULL OR EXISTS (SELECT 1 FROM olympiad_stage st WHERE st.id = stage_id AND st.results_published_at IS NOT NULL))`,
        [o.id, childId],
      );
      const viewStages = [];
      for (const s of stages) {
        const entry = entries.find((e) => e.stage_id === s.id) ?? null;
        const eligibility = entry ? 'registered' : await this.eligibility(o, s, child, ticket.earned);
        viewStages.push({
          id: s.id,
          kind: s.kind,
          inPerson: IN_PERSON_STAGES.includes(s.kind),
          opensAt: s.opens_at,
          closesAt: s.closes_at,
          registrationClosesAt: s.registration_closes_at ?? s.closes_at,
          state: stageState(s),
          eligibility,
          venues: IN_PERSON_STAGES.includes(s.kind) && (eligibility === 'ok' || entry) ? await this.venueOptions(s.id, child.region_id) : [],
          entry: entry ? await this.entryView(entry, s, o.is_ranked, childId) : null,
        });
      }
      out.push({
        id: o.id,
        slug: o.slug,
        titleUz: o.title_uz,
        titleRu: o.title_ru,
        isRanked: o.is_ranked,
        certificateTopPct: o.certificate_top_pct,
        stages: viewStages,
        awards: awards.map((a) => ({ kind: a.kind, place: a.place, stageId: a.stage_id })),
      });
    }
    return {
      child: { id: childId, givenName: child.given_name, grade: child.grade, regionUz: child.region_uz, regionRu: child.region_ru },
      // design/07 "Who comes with Madina": the owner, checked at the entrance.
      owner: { name: child.owner_name },
      ticket,
      olympiads: out,
    };
  }

  /**
   * Register for a stage (owner only — § 3: the co-guardian may not). In-person
   * stages need a venue with a free seat. Registering again for the same stage
   * changes the venue; a cancelled registration comes back to life.
   */
  async register(actor: Actor, childId: string, olympiadId: string, input: { stageId?: string; venueId?: string | null; source?: string | null }) {
    if (!UUID.test(olympiadId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const child = await this.child(childId);
    const o = await this.db.one<{ id: string; title_uz: string; grade_min: number; grade_max: number; is_ranked: boolean; qualify_top_pct: number }>(
      `SELECT o.id, o.title_uz, o.grade_min, o.grade_max, o.is_ranked, o.qualify_top_pct
         FROM olympiad o JOIN season s ON s.id = o.season_id AND s.is_current WHERE o.id = $1`,
      [olympiadId],
    );
    if (!o) throw new NotFoundException({ error: 'NOT_FOUND' });
    const stages = await this.stages(o.id, child.grade);
    // No stage named: the first one still open for registration.
    const stage = input.stageId
      ? stages.find((s) => s.id === input.stageId)
      : stages.find((s) => registrationOpen(s));
    if (!stage) throw new NotFoundException({ error: 'STAGE_NOT_FOUND' });

    const ticket = await this.ticket(childId);
    const existing = await this.db.one<{ id: string; cancelled_at: Date | null; locked: boolean }>(
      `SELECT id, cancelled_at,
              (checked_in_at IS NOT NULL OR EXISTS (SELECT 1 FROM session s WHERE s.olympiad_entry_id = olympiad_entry.id)) AS locked
         FROM olympiad_entry WHERE stage_id = $1 AND child_id = $2`,
      [stage.id, childId],
    );
    // Checked in at the door, or already sitting the stage: the seat is final —
    // moving it would silently undo the proctor's check-in.
    if (existing && !existing.cancelled_at && existing.locked) throw new ConflictException({ error: 'ALREADY_CHECKED_IN' });
    if (!existing || existing.cancelled_at) {
      const why = await this.eligibility(o, stage, child, ticket.earned);
      if (why !== 'ok') throw new ConflictException({ error: 'NOT_ELIGIBLE', details: { reason: why } });
    } else if (!registrationOpen(stage)) {
      throw new ConflictException({ error: 'NOT_ELIGIBLE', details: { reason: 'closed' } });
    }

    const inPerson = IN_PERSON_STAGES.includes(stage.kind);
    if (inPerson && !input.venueId) throw new BadRequestException({ error: 'VENUE_REQUIRED' });
    if (inPerson) await this.checkVenue(stage.id, input.venueId!, child.region_id, existing?.id ?? null);

    const via =
      stage.kind === 'spring_final' ? (ticket.earned ? 'ticket' : 'qualified') : stage.kind === 'mini_final' ? 'invited' : 'open';
    let entryId: string;
    try {
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO olympiad_entry (olympiad_id, stage_id, child_id, registered_by, source, ticket_from_waves,
                                     region_id, grade, entry_via, venue_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (stage_id, child_id) DO UPDATE
            SET venue_id = EXCLUDED.venue_id, cancelled_at = NULL,
                checked_in_at = CASE WHEN olympiad_entry.venue_id IS DISTINCT FROM EXCLUDED.venue_id THEN NULL
                                     ELSE olympiad_entry.checked_in_at END,
                source = COALESCE(olympiad_entry.source, EXCLUDED.source)
         RETURNING id`,
        [o.id, stage.id, childId, actor.personId, input.source?.slice(0, 64) ?? null, ticket.waves, child.region_id, child.grade, via, inPerson ? input.venueId : null],
      );
      entryId = row!.id;
    } catch (err) {
      // The DB's own-child rule: a venue proctored by this child's guardian.
      if ((err as { code?: string }).code === '23001') throw new ConflictException({ error: 'VENUE_PROCTORED_BY_GUARDIAN' });
      throw err;
    }

    if (!existing || existing.cancelled_at) {
      await this.notify.queue({
        personId: actor.personId,
        template: 'olympiad_registered',
        vars: { child: child.given_name, olympiad: o.title_uz, details: `${this.config.webOrigin}/uz/family/children/${childId}/olympiad` },
        throttleKey: `olympiad_registered:${entryId}`,
      });
    }
    await this.audit.write({ action: 'olympiad.registered', personId: actor.personId, payload: { entryId, childId, stage: stage.kind } });
    return { entryId, stageId: stage.id, entryVia: via };
  }

  /** design/07 "Cancel registration" — before the stage closes, and not once a session exists. */
  async cancel(actor: Actor, childId: string, entryId: string) {
    if (!UUID.test(entryId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const e = await this.db.one<{ id: string; closes_at: Date; has_session: boolean }>(
      `SELECT e.id, st.closes_at, EXISTS (SELECT 1 FROM session s WHERE s.olympiad_entry_id = e.id) AS has_session
         FROM olympiad_entry e JOIN olympiad_stage st ON st.id = e.stage_id
        WHERE e.id = $1 AND e.child_id = $2 AND e.cancelled_at IS NULL`,
      [entryId, childId],
    );
    if (!e) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (e.has_session) throw new ConflictException({ error: 'ALREADY_TAKEN' });
    if (e.closes_at.getTime() <= Date.now()) throw new ConflictException({ error: 'STAGE_CLOSED' });
    await this.db.query(`UPDATE olympiad_entry SET cancelled_at = now(), venue_id = NULL, checked_in_at = NULL WHERE id = $1`, [entryId]);
    await this.audit.write({ action: 'olympiad.registration_cancelled', personId: actor.personId, payload: { entryId, childId } });
    return { ok: true };
  }

  /**
   * An online stage in kid mode, at home, while the stage is open. The
   * session is `mode = 'olympiad'` with no wave — the DB refuses to attach it
   * to a wave, and measurement reads monitoring sessions only (§ 9).
   */
  async start(actor: Actor, childId: string, entryId: string) {
    if (!UUID.test(entryId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const e = await this.db.one<{ id: string; kind: StageKind; opens_at: Date; closes_at: Date; form_id: string | null }>(
      `SELECT e.id, st.kind::text AS kind, st.opens_at, st.closes_at, sf.form_id
         FROM olympiad_entry e
         JOIN olympiad_stage st ON st.id = e.stage_id
    LEFT JOIN olympiad_stage_form sf ON sf.stage_id = st.id AND sf.grade = e.grade
        WHERE e.id = $1 AND e.child_id = $2 AND e.cancelled_at IS NULL`,
      [entryId, childId],
    );
    if (!e) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (!ONLINE_STAGES.includes(e.kind)) throw new ConflictException({ error: 'IN_PERSON_STAGE' });
    if (stageState(e) !== 'open') throw new ConflictException({ error: 'STAGE_NOT_OPEN' });
    if (!e.form_id) throw new ConflictException({ error: 'STAGE_NOT_READY' });

    const existing = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status::text FROM session WHERE olympiad_entry_id = $1 AND status <> 'voided'`,
      [entryId],
    );
    if (existing?.status === 'submitted') throw new ConflictException({ error: 'ENTRY_TAKEN' });
    if (existing?.status === 'started') return { sessionId: existing.id, resumed: true };

    const enr = await this.db.one<{ grade: number; region_id: number; school_id: string | null; consent: boolean }>(
      `SELECT e.grade, e.school_region_id AS region_id, e.school_id,
              EXISTS (SELECT 1 FROM consent k WHERE k.child_id = e.child_id AND k.type = 'data_processing' AND k.revoked_at IS NULL) AS consent
         FROM enrolment e WHERE e.child_id = $1 AND e.ended_at IS NULL ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1`,
      [childId],
    );
    if (!enr) throw new ConflictException({ error: 'NO_ENROLMENT' });
    if (!enr.consent) throw new ConflictException({ error: 'CONSENT_REQUIRED' });
    try {
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO session (child_id, mode, form_id, olympiad_entry_id, launched_by, launch_context,
                              grade_snapshot, region_snapshot, school_snapshot)
         VALUES ($1, 'olympiad', $2, $3, $4, 'home', $5, $6, $7) RETURNING id`,
        [childId, e.form_id, entryId, actor.personId, enr.grade, enr.region_id, enr.school_id],
      );
      await this.audit.write({ action: 'session.started', personId: actor.personId, payload: { sessionId: row!.id, childId, entryId, mode: 'olympiad' } });
      return { sessionId: row!.id, resumed: false };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const again = await this.db.one<{ id: string }>(`SELECT id FROM session WHERE olympiad_entry_id = $1 AND status = 'started'`, [entryId]);
        if (again) return { sessionId: again.id, resumed: true };
      }
      throw err;
    }
  }

  /** `/o/[slug]` before sign-in: what the olympiad is and when. */
  async publicView(slug: string) {
    const o = await this.db.one<{ id: string; title_uz: string; title_ru: string; grade_min: number; grade_max: number; is_ranked: boolean }>(
      `SELECT o.id, o.title_uz, o.title_ru, o.grade_min, o.grade_max, o.is_ranked
         FROM olympiad o JOIN season s ON s.id = o.season_id AND s.is_current WHERE o.slug = $1`,
      [slug],
    );
    if (!o) throw new NotFoundException({ error: 'NOT_FOUND' });
    const stages = await this.db.query<{ kind: StageKind; opens_at: Date; closes_at: Date; registration_closes_at: Date | null }>(
      `SELECT kind::text, opens_at, closes_at, registration_closes_at FROM olympiad_stage WHERE olympiad_id = $1 ORDER BY opens_at`,
      [o.id],
    );
    return {
      slug,
      titleUz: o.title_uz,
      titleRu: o.title_ru,
      gradeMin: o.grade_min,
      gradeMax: o.grade_max,
      isRanked: o.is_ranked,
      stages: stages.map((s) => ({
        kind: s.kind,
        inPerson: IN_PERSON_STAGES.includes(s.kind),
        opensAt: s.opens_at,
        closesAt: s.closes_at,
        registrationClosesAt: s.registration_closes_at ?? s.closes_at,
        state: stageState(s),
      })),
    };
  }

  // ============================================================= helpers

  /** "≥ 3 monitoring waves" — submitted monitoring sessions in the current season. */
  async ticket(childId: string) {
    const r = await this.db.one<{ n: number; waves: { ordinal: number; submittedAt: string }[] | null }>(
      `SELECT count(*)::int AS n,
              json_agg(json_build_object('ordinal', w.ordinal, 'submittedAt', s.submitted_at) ORDER BY w.ordinal) AS waves
         FROM session s JOIN wave w ON w.id = s.wave_id JOIN season se ON se.id = w.season_id AND se.is_current
        WHERE s.child_id = $1 AND s.mode = 'monitoring' AND s.status = 'submitted'`,
      [childId],
    );
    const waves = r?.n ?? 0;
    return { waves, needed: TICKET_WAVES, earned: waves >= TICKET_WAVES, taken: r?.waves ?? [] };
  }

  private async eligibility(
    o: { id: string; grade_min: number; grade_max: number; is_ranked: boolean },
    s: StageRow,
    child: { id: string; grade: number },
    ticket: boolean,
  ): Promise<Eligibility> {
    if (child.grade < o.grade_min || child.grade > o.grade_max) return 'grade';
    if (!registrationOpen(s)) return 'closed';
    if (!s.has_form && ONLINE_STAGES.includes(s.kind)) return 'no_form';
    if (s.kind === 'spring_final') {
      if (ticket) return 'ok';
      // Without a ticket: the top qualify_top_pct of the PUBLISHED spring online stage.
      const q = await this.db.one(
        `SELECT 1 FROM olympiad_entry e JOIN olympiad_stage st ON st.id = e.stage_id AND st.kind = 'spring_online'
                                                             AND st.results_published_at IS NOT NULL
          WHERE e.olympiad_id = $1 AND e.child_id = $2 AND e.qualified AND e.cancelled_at IS NULL`,
        [o.id, child.id],
      );
      return q ? 'ok' : 'needs_ticket_or_qualification';
    }
    if (s.kind === 'mini_final') {
      const q = await this.db.one(
        `SELECT 1 FROM olympiad_entry e JOIN olympiad_stage st ON st.id = e.stage_id AND st.kind = 'autumn_online'
                                                             AND st.results_published_at IS NOT NULL
          WHERE e.olympiad_id = $1 AND e.child_id = $2 AND e.qualified AND e.cancelled_at IS NULL`,
        [o.id, child.id],
      );
      return q ? 'ok' : 'needs_invitation';
    }
    return 'ok';
  }

  private async checkVenue(stageId: string, venueId: string, regionId: number, entryId: string | null) {
    if (!UUID.test(venueId)) throw new BadRequestException({ error: 'VENUE_REQUIRED' });
    const v = await this.db.one<{ region_id: number | null; capacity: number; seated: number }>(
      `SELECT v.region_id, v.capacity,
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL
                  AND e.id IS DISTINCT FROM $3::uuid) AS seated
         FROM olympiad_venue v WHERE v.id = $1 AND v.stage_id = $2`,
      [venueId, stageId, entryId],
    );
    if (!v) throw new NotFoundException({ error: 'VENUE_NOT_FOUND' });
    if (v.region_id !== null && v.region_id !== regionId) throw new ConflictException({ error: 'VENUE_OTHER_REGION' });
    if (v.seated >= v.capacity) throw new ConflictException({ error: 'VENUE_FULL' });
  }

  private async venueOptions(stageId: string, regionId: number) {
    return this.db.query(
      `SELECT v.id, v.name, v.address, v.starts_at AS "startsAt", v.capacity,
              v.capacity - (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL) AS "seatsLeft"
         FROM olympiad_venue v WHERE v.stage_id = $1 AND (v.region_id IS NULL OR v.region_id = $2)
        ORDER BY v.starts_at, v.name`,
      [stageId, regionId],
    );
  }

  private async stages(olympiadId: string, grade: number): Promise<StageRow[]> {
    return this.db.query<StageRow>(
      `SELECT st.id, st.olympiad_id, st.kind::text AS kind, st.opens_at, st.closes_at, st.registration_closes_at,
              st.results_published_at,
              EXISTS (SELECT 1 FROM olympiad_stage_form sf WHERE sf.stage_id = st.id AND sf.grade = $2) AS has_form
         FROM olympiad_stage st WHERE st.olympiad_id = $1
        ORDER BY array_position(ARRAY['autumn_online','mini_final','spring_online','spring_final']::olympiad_stage_kind[], st.kind)`,
      [olympiadId, grade],
    );
  }

  private async entries(childId: string, olympiadId: string): Promise<EntryRow[]> {
    return this.db.query<EntryRow>(
      `SELECT e.id, e.stage_id, e.venue_id, v.name AS venue_name, v.address AS venue_address, v.starts_at AS venue_starts_at,
              e.entry_via, e.registered_at, e.checked_in_at, s.id AS session_id, s.status::text AS session_status,
              e.result_rank, e.result_pct_low, e.result_pct_high, e.result_cohort_n,
              e.certificate_issued_at IS NOT NULL AS certificate, e.qualified
         FROM olympiad_entry e
    LEFT JOIN olympiad_venue v ON v.id = e.venue_id
    LEFT JOIN LATERAL (SELECT id, status FROM session WHERE olympiad_entry_id = e.id AND status <> 'voided'
                        ORDER BY started_at DESC LIMIT 1) s ON true
        WHERE e.child_id = $1 AND e.olympiad_id = $2 AND e.cancelled_at IS NULL`,
      [childId, olympiadId],
    );
  }

  /**
   * The family's view of one entry. Before publication: registration, venue
   * and whether it was taken. After: the band (a range, only with a cohort of
   * 30+), the certificate, whether it qualified the child onward, and a
   * diagnostic from the child's own answers.
   */
  private async entryView(e: EntryRow, s: StageRow, ranked: boolean, childId: string) {
    const published = s.results_published_at !== null;
    return {
      id: e.id,
      entryVia: e.entry_via,
      registeredAt: e.registered_at,
      venue: e.venue_id ? { id: e.venue_id, name: e.venue_name, address: e.venue_address, startsAt: e.venue_starts_at } : null,
      checkedIn: e.checked_in_at !== null,
      session: e.session_id ? { id: e.session_id, status: e.session_status } : null,
      result: published && e.session_status === 'submitted'
        ? {
            band: ranked && e.result_pct_low !== null ? { top: { from: Math.max(1, 100 - e.result_pct_high!), to: Math.max(1, 100 - e.result_pct_low) } } : null,
            cohortN: e.result_cohort_n,
            certificate: e.certificate,
            qualified: e.qualified,
            diagnostic: await this.diagnostic(e.session_id!, ranked),
          }
        : null,
      resultsPublished: published,
      childId,
    };
  }

  /**
   * A diagnostic from one session: grades 3–4 get each cluster relative to the
   * child's own overall result (as in the M5 report) and the most frequent
   * mistake; grades 0–2 get a skills map from this session alone — with one
   * sitting there is nothing to confirm, so "strong here" is ≥ 2 correct, not
   * "secure".
   */
  private async diagnostic(sessionId: string, ranked: boolean) {
    const rows = await this.db.query<{ cluster: string; skill_code: string | null; is_correct: boolean | null }>(
      `SELECT t.cluster::text AS cluster, i.skill_code, r.is_correct
         FROM response r
         JOIN session s ON s.id = r.session_id
         JOIN form_item fi ON fi.form_id = s.form_id AND fi.item_version_id = r.item_version_id AND fi.is_scored
         JOIN item_version v ON v.id = r.item_version_id
         JOIN item i ON i.id = v.item_id
         JOIN topic t ON t.code = i.topic_code
        WHERE r.session_id = $1`,
      [sessionId],
    );
    if (!rows.length) return null;
    const overall = rows.filter((r) => r.is_correct).length / rows.length;
    if (ranked) {
      const clusters: Record<string, string> = {};
      for (const c of ['numeracy', 'reasoning', 'language']) {
        const cs = rows.filter((r) => r.cluster === c);
        if (cs.length) clusters[c] = clusterStanding(cs.filter((r) => r.is_correct).length / cs.length, overall);
      }
      const mistake = await this.db.one<{ code: string; name_uz: string; name_ru: string; explain_uz: string; explain_ru: string }>(
        `SELECT m.code, m.name_uz, m.name_ru, m.explain_uz, m.explain_ru
           FROM response r JOIN item_option o ON o.id = r.chosen_option_id AND o.misconception_code IS NOT NULL
           JOIN misconception m ON m.code = o.misconception_code
          WHERE r.session_id = $1
          GROUP BY m.code ORDER BY count(*) DESC, m.code LIMIT 1`,
        [sessionId],
      );
      return {
        kind: 'clusters' as const,
        clusters,
        mistake: mistake
          ? { code: mistake.code, nameUz: mistake.name_uz, nameRu: mistake.name_ru, explainUz: mistake.explain_uz, explainRu: mistake.explain_ru }
          : null,
      };
    }
    const skills = await this.db.query<{ code: string; name_uz: string; name_ru: string; correct: number }>(
      `SELECT sk.code, sk.name_uz, sk.name_ru, count(*) FILTER (WHERE r.is_correct)::int AS correct
         FROM response r
         JOIN session s ON s.id = r.session_id
         JOIN form_item fi ON fi.form_id = s.form_id AND fi.item_version_id = r.item_version_id AND fi.is_scored
         JOIN item_version v ON v.id = r.item_version_id JOIN item i ON i.id = v.item_id
         JOIN skill sk ON sk.code = i.skill_code
        WHERE r.session_id = $1 GROUP BY sk.code ORDER BY sk.code`,
      [sessionId],
    );
    return {
      kind: 'skills' as const,
      skills: skills.map((k) => ({
        code: k.code,
        nameUz: k.name_uz,
        nameRu: k.name_ru,
        state: k.correct >= 2 ? 'strong' : k.correct === 1 ? 'emerging' : 'not_yet',
      })),
    };
  }

  private async child(childId: string) {
    const c = await this.db.one<{
      id: string;
      given_name: string;
      grade: number;
      region_id: number;
      region_uz: string;
      region_ru: string;
      owner_name: string;
    }>(
      `SELECT c.id, c.given_name, e.grade, e.school_region_id AS region_id, r.name_uz AS region_uz, r.name_ru AS region_ru,
              (SELECT p.full_name FROM guardianship g JOIN person p ON p.id = g.person_id
                WHERE g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL LIMIT 1) AS owner_name
         FROM child c
         JOIN LATERAL (SELECT * FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
         JOIN region r ON r.id = e.school_region_id
        WHERE c.id = $1 AND c.anonymised_at IS NULL`,
      [childId],
    );
    if (!c) throw new ConflictException({ error: 'NO_ENROLMENT' });
    return c;
  }
}
