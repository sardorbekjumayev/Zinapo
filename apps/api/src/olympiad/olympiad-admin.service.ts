import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { toE164 } from '../common/phone.util';
import { Actor } from '../authz';
import { IN_PERSON_STAGES, StageKind, UUID, stageState } from './olympiad.common';

export interface OlympiadInput {
  slug: string;
  titleUz: string;
  titleRu: string;
  gradeMin: number;
  gradeMax: number;
  certificateTopPct?: number;
  qualifyTopPct?: number;
  miniFinalTopN?: number;
  bonusRate?: number;
  cupTopN?: number;
}

export interface VenueInput {
  stageId: string;
  regionId: number | null;
  name: string;
  address: string;
  capacity: number;
  startsAt: string;
}

/**
 * § 8.5 "Olympiad operator": stages, forms per grade, venues and capacity,
 * proctors, entries. Results and awards live in `OlympiadResultsService`.
 *
 * `is_ranked` is not a choice: an olympiad that reaches grades 0–2 is a
 * diagnostic marathon with no places (§ 8.1.6, the `olympiad_rank_not_for_young`
 * constraint), so it follows from `gradeMin`.
 */
@Injectable()
export class OlympiadAdminService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async list() {
    return this.db.query(
      `SELECT o.id, o.slug, o.title_uz AS "titleUz", o.title_ru AS "titleRu", o.grade_min AS "gradeMin",
              o.grade_max AS "gradeMax", o.is_ranked AS "isRanked", s.code AS "seasonCode",
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.olympiad_id = o.id AND e.cancelled_at IS NULL) AS entries,
              (SELECT json_agg(json_build_object('kind', st.kind, 'opensAt', st.opens_at, 'closesAt', st.closes_at,
                                                 'published', st.results_published_at IS NOT NULL) ORDER BY st.opens_at)
                 FROM olympiad_stage st WHERE st.olympiad_id = o.id) AS stages
         FROM olympiad o JOIN season s ON s.id = o.season_id
        ORDER BY s.starts_on DESC, o.grade_min DESC`,
    );
  }

  async create(actor: Actor, input: OlympiadInput) {
    if (input.gradeMax < input.gradeMin) throw new BadRequestException({ error: 'GRADES_INVALID' });
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) throw new ConflictException({ error: 'NO_CURRENT_SEASON' });
    try {
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO olympiad (season_id, slug, title_uz, title_ru, grade_min, grade_max, is_ranked,
                               certificate_top_pct, qualify_top_pct, mini_final_top_n, bonus_rate, cup_top_n)
         VALUES ($1, $2, $3, $4, $5::smallint, $6::smallint, $5::smallint >= 3, $7, $8, $9, $10, $11) RETURNING id`,
        [
          season.id,
          input.slug,
          input.titleUz,
          input.titleRu,
          input.gradeMin,
          input.gradeMax,
          input.certificateTopPct ?? 15,
          input.qualifyTopPct ?? 30,
          input.miniFinalTopN ?? 100,
          input.bonusRate ?? 0,
          input.cupTopN ?? 3,
        ],
      );
      await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: row!.id, created: true } });
      return this.detail(row!.id);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'SLUG_TAKEN' });
      throw err;
    }
  }

  /** Rules may change; the grade range may not once anyone has registered. */
  async update(actor: Actor, id: string, patch: Partial<OlympiadInput>) {
    const o = await this.own(id);
    if ((patch.gradeMin !== undefined || patch.gradeMax !== undefined) && o.entries > 0) {
      throw new ConflictException({ error: 'HAS_ENTRIES' });
    }
    await this.db.query(
      `UPDATE olympiad SET
          title_uz = COALESCE($2, title_uz), title_ru = COALESCE($3, title_ru),
          grade_min = COALESCE($4::smallint, grade_min), grade_max = COALESCE($5::smallint, grade_max),
          is_ranked = COALESCE($4::smallint, grade_min) >= 3,
          certificate_top_pct = COALESCE($6, certificate_top_pct), qualify_top_pct = COALESCE($7, qualify_top_pct),
          mini_final_top_n = COALESCE($8, mini_final_top_n), bonus_rate = COALESCE($9, bonus_rate),
          cup_top_n = COALESCE($10, cup_top_n)
        WHERE id = $1`,
      [
        id,
        patch.titleUz ?? null,
        patch.titleRu ?? null,
        patch.gradeMin ?? null,
        patch.gradeMax ?? null,
        patch.certificateTopPct ?? null,
        patch.qualifyTopPct ?? null,
        patch.miniFinalTopN ?? null,
        patch.bonusRate ?? null,
        patch.cupTopN ?? null,
      ],
    );
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: id } });
    return this.detail(id);
  }

  async detail(id: string) {
    await this.own(id);
    const o = await this.db.one(
      `SELECT o.id, o.slug, o.title_uz AS "titleUz", o.title_ru AS "titleRu", o.grade_min AS "gradeMin",
              o.grade_max AS "gradeMax", o.is_ranked AS "isRanked", o.certificate_top_pct AS "certificateTopPct",
              o.qualify_top_pct AS "qualifyTopPct", o.mini_final_top_n AS "miniFinalTopN",
              o.bonus_rate::float8 AS "bonusRate", o.cup_top_n AS "cupTopN", s.code AS "seasonCode"
         FROM olympiad o JOIN season s ON s.id = o.season_id WHERE o.id = $1`,
      [id],
    );
    const stages = await this.db.query<{
      id: string;
      kind: StageKind;
      opens_at: Date;
      closes_at: Date;
      registration_closes_at: Date | null;
      results_computed_at: Date | null;
      results_published_at: Date | null;
      forms: { grade: number; formId: string; label: string }[] | null;
      entries: number;
      submitted: number;
    }>(
      `SELECT st.id, st.kind::text AS kind, st.opens_at, st.closes_at, st.registration_closes_at,
              st.results_computed_at, st.results_published_at,
              (SELECT json_agg(json_build_object('grade', sf.grade, 'formId', sf.form_id, 'label', f.label) ORDER BY sf.grade)
                 FROM olympiad_stage_form sf JOIN form f ON f.id = sf.form_id WHERE sf.stage_id = st.id) AS forms,
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.stage_id = st.id AND e.cancelled_at IS NULL) AS entries,
              (SELECT count(*)::int FROM olympiad_entry e JOIN session s ON s.olympiad_entry_id = e.id AND s.status = 'submitted'
                WHERE e.stage_id = st.id AND e.cancelled_at IS NULL) AS submitted
         FROM olympiad_stage st WHERE st.olympiad_id = $1
        ORDER BY array_position(ARRAY['autumn_online','mini_final','spring_online','spring_final']::olympiad_stage_kind[], st.kind)`,
      [id],
    );
    const venues = await this.venues(id);
    return {
      ...o,
      stages: stages.map((s) => ({
        id: s.id,
        kind: s.kind,
        opensAt: s.opens_at,
        closesAt: s.closes_at,
        registrationClosesAt: s.registration_closes_at,
        state: stageState(s),
        inPerson: IN_PERSON_STAGES.includes(s.kind),
        forms: s.forms ?? [],
        entries: s.entries,
        submitted: s.submitted,
        resultsComputedAt: s.results_computed_at,
        resultsPublishedAt: s.results_published_at,
      })),
      venues,
    };
  }

  /** One stage per kind per olympiad: setting it again moves its dates. */
  async upsertStage(actor: Actor, id: string, kind: StageKind, dates: { opensAt: string; closesAt: string; registrationClosesAt?: string | null }) {
    await this.own(id);
    if (Date.parse(dates.closesAt) <= Date.parse(dates.opensAt)) throw new BadRequestException({ error: 'WINDOW_INVALID' });
    await this.db.query(
      `INSERT INTO olympiad_stage (olympiad_id, kind, opens_at, closes_at, registration_closes_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (olympiad_id, kind) DO UPDATE
          SET opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at,
              registration_closes_at = EXCLUDED.registration_closes_at`,
      [id, kind, dates.opensAt, dates.closesAt, dates.registrationClosesAt ?? null],
    );
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: id, stage: kind } });
    return this.detail(id);
  }

  /** A frozen olympiad-mode form of that grade; a stage that has sessions keeps its form. */
  async setForm(actor: Actor, id: string, stageId: string, grade: number, formId: string) {
    const o = await this.own(id);
    if (grade < o.grade_min || grade > o.grade_max) throw new BadRequestException({ error: 'GRADE_OUT_OF_RANGE' });
    const stage = await this.db.one(`SELECT 1 FROM olympiad_stage WHERE id = $1 AND olympiad_id = $2`, [stageId, id]);
    if (!stage) throw new NotFoundException({ error: 'NOT_FOUND' });
    const form = await this.db.one<{ mode: string; grade: number; frozen: boolean }>(
      `SELECT mode::text, grade, frozen_at IS NOT NULL AS frozen FROM form WHERE id = $1`,
      [formId],
    );
    if (!form) throw new NotFoundException({ error: 'FORM_NOT_FOUND' });
    if (form.mode !== 'olympiad' || form.grade !== grade) throw new ConflictException({ error: 'FORM_MISMATCH' });
    if (!form.frozen) throw new ConflictException({ error: 'FORM_NOT_FROZEN' });
    const started = await this.db.one(
      `SELECT 1 FROM session s JOIN olympiad_entry e ON e.id = s.olympiad_entry_id
        WHERE e.stage_id = $1 AND e.grade = $2 LIMIT 1`,
      [stageId, grade],
    );
    if (started) throw new ConflictException({ error: 'STAGE_STARTED' });
    await this.db.query(
      `INSERT INTO olympiad_stage_form (stage_id, grade, form_id) VALUES ($1, $2, $3)
       ON CONFLICT (stage_id, grade) DO UPDATE SET form_id = EXCLUDED.form_id`,
      [stageId, grade, formId],
    );
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: id, stageId, grade, formId } });
    return this.detail(id);
  }

  async venues(id: string) {
    return this.db.query(
      `SELECT v.id, v.stage_id AS "stageId", st.kind::text AS "stageKind", v.region_id AS "regionId",
              r.name_uz AS "regionUz", r.name_ru AS "regionRu", v.name, v.address, v.capacity, v.starts_at AS "startsAt",
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL) AS seated,
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL AND e.checked_in_at IS NOT NULL) AS "checkedIn",
              (SELECT json_agg(json_build_object('personId', p.id, 'name', p.full_name) ORDER BY p.full_name)
                 FROM proctor_assignment pa JOIN person p ON p.id = pa.person_id WHERE pa.venue_id = v.id) AS proctors
         FROM olympiad_venue v
    LEFT JOIN olympiad_stage st ON st.id = v.stage_id
    LEFT JOIN region r ON r.id = v.region_id
        WHERE v.olympiad_id = $1
        ORDER BY v.starts_at, v.name`,
      [id],
    );
  }

  async createVenue(actor: Actor, id: string, input: VenueInput) {
    await this.own(id);
    const stage = await this.db.one<{ kind: StageKind }>(
      `SELECT kind::text FROM olympiad_stage WHERE id = $1 AND olympiad_id = $2`,
      [input.stageId, id],
    );
    if (!stage) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (!IN_PERSON_STAGES.includes(stage.kind)) throw new ConflictException({ error: 'STAGE_IS_ONLINE' });
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO olympiad_venue (olympiad_id, stage_id, region_id, name, address, capacity, starts_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [id, input.stageId, input.regionId, input.name.trim(), input.address.trim(), input.capacity, input.startsAt],
    );
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: id, venueId: row!.id } });
    return this.venues(id);
  }

  /** Capacity can grow freely; it cannot drop below the children already seated. */
  async updateVenue(actor: Actor, id: string, venueId: string, patch: Partial<Omit<VenueInput, 'stageId'>>) {
    await this.ownVenue(id, venueId);
    if (patch.capacity !== undefined) {
      const seated = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM olympiad_entry WHERE venue_id = $1 AND cancelled_at IS NULL`,
        [venueId],
      );
      if ((seated?.n ?? 0) > patch.capacity) throw new ConflictException({ error: 'BELOW_SEATED', details: { seated: seated?.n } });
    }
    await this.db.query(
      `UPDATE olympiad_venue SET name = COALESCE($2, name), address = COALESCE($3, address),
              capacity = COALESCE($4, capacity), starts_at = COALESCE($5, starts_at),
              region_id = CASE WHEN $6::boolean THEN $7::smallint ELSE region_id END
        WHERE id = $1`,
      [venueId, patch.name ?? null, patch.address ?? null, patch.capacity ?? null, patch.startsAt ?? null, patch.regionId !== undefined, patch.regionId ?? null],
    );
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { olympiadId: id, venueId } });
    return this.venues(id);
  }

  /**
   * Assign a proctor by phone: a person holding the `proctor` role. The DB
   * refuses a venue where their own child competes (§ 2.1).
   */
  async addProctor(actor: Actor, id: string, venueId: string, rawPhone: string) {
    await this.ownVenue(id, venueId);
    const phone = toE164(rawPhone);
    const person = phone
      ? await this.db.one<{ id: string }>(
          `SELECT p.id FROM person p JOIN staff_role_assignment s ON s.person_id = p.id
            WHERE p.phone = $1 AND s.role = 'proctor' AND s.revoked_at IS NULL`,
          [phone],
        )
      : null;
    if (!person) throw new NotFoundException({ error: 'NOT_A_PROCTOR' });
    try {
      await this.db.query(`INSERT INTO proctor_assignment (venue_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [venueId, person.id]);
    } catch (err) {
      if ((err as { code?: string }).code === '23001') throw new ConflictException({ error: 'OWN_CHILD_AT_VENUE' });
      throw err;
    }
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { venueId, proctorAdded: person.id } });
    return this.venues(id);
  }

  async removeProctor(actor: Actor, id: string, venueId: string, personId: string) {
    await this.ownVenue(id, venueId);
    await this.db.query(`DELETE FROM proctor_assignment WHERE venue_id = $1 AND person_id = $2`, [venueId, personId]);
    await this.audit.write({ action: 'olympiad.changed', personId: actor.personId, payload: { venueId, proctorRemoved: personId } });
    return this.venues(id);
  }

  /** design/07 "We'll text the exact address and start time 10 days before the final." */
  async sendVenueDetails(actor: Actor, id: string, venueId: string) {
    await this.ownVenue(id, venueId);
    const rows = await this.db.query<{ owner_id: string; child: string; olympiad: string; venue: string; address: string; starts_at: Date; entry_id: string }>(
      `SELECT g.person_id AS owner_id, c.given_name AS child, o.title_uz AS olympiad, v.name AS venue, v.address,
              v.starts_at, e.id AS entry_id
         FROM olympiad_entry e
         JOIN olympiad_venue v ON v.id = e.venue_id
         JOIN olympiad o ON o.id = e.olympiad_id
         JOIN child c ON c.id = e.child_id
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE e.venue_id = $1 AND e.cancelled_at IS NULL`,
      [venueId],
    );
    let sent = 0;
    for (const r of rows) {
      const id2 = await this.notify.queue({
        personId: r.owner_id,
        template: 'final_venue_details',
        vars: {
          olympiad: r.olympiad,
          date: r.starts_at.toISOString(),
          venue: r.venue,
          address: r.address,
          child: r.child,
        },
        throttleKey: `final_venue_details:${r.entry_id}:${r.starts_at.toISOString()}`,
      });
      if (id2) sent += 1;
    }
    return { sent, already: rows.length - sent };
  }

  /** Entries of a stage — names and grade for the operator, never a PINFL. */
  async entries(id: string, stageId: string) {
    await this.own(id);
    return this.db.query(
      `SELECT e.id, c.given_name || ' ' || initcap(c.family_name) AS name, e.grade, e.region_id AS "regionId",
              r.name_uz AS "regionUz", r.name_ru AS "regionRu", e.entry_via AS "entryVia", e.source, e.registered_at AS "registeredAt",
              v.name AS venue, e.checked_in_at AS "checkedInAt", e.accompanying_adult_matches_owner AS "adultMatchesOwner",
              s.status::text AS "sessionStatus", e.result_score AS score, e.result_rank AS rank,
              e.result_percentile AS percentile, e.certificate_issued_at IS NOT NULL AS certificate,
              e.qualified, e.flagged_at AS "flaggedAt"
         FROM olympiad_entry e
         JOIN child c ON c.id = e.child_id
    LEFT JOIN region r ON r.id = e.region_id
    LEFT JOIN olympiad_venue v ON v.id = e.venue_id
    LEFT JOIN LATERAL (SELECT status FROM session WHERE olympiad_entry_id = e.id AND status <> 'voided'
                        ORDER BY started_at DESC LIMIT 1) s ON true
        WHERE e.stage_id = $1 AND e.cancelled_at IS NULL
        ORDER BY e.grade DESC, e.region_id, e.result_rank NULLS LAST, c.given_name
        LIMIT 2000`,
      [stageId],
    );
  }

  /** Olympiad-mode frozen forms the operator can attach. */
  async forms(grade?: number) {
    return this.db.query(
      `SELECT f.id, f.grade, f.label, f.frozen_at AS "frozenAt",
              (SELECT count(*)::int FROM form_item fi WHERE fi.form_id = f.id) AS items
         FROM form f WHERE f.mode = 'olympiad' AND f.frozen_at IS NOT NULL AND ($1::smallint IS NULL OR f.grade = $1)
        ORDER BY f.grade, f.created_at DESC`,
      [grade ?? null],
    );
  }

  private async own(id: string) {
    if (!UUID.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const o = await this.db.one<{ grade_min: number; grade_max: number; entries: number }>(
      `SELECT grade_min, grade_max,
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.olympiad_id = o.id) AS entries
         FROM olympiad o WHERE id = $1`,
      [id],
    );
    if (!o) throw new NotFoundException({ error: 'NOT_FOUND' });
    return o;
  }

  private async ownVenue(id: string, venueId: string) {
    if (!UUID.test(venueId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const v = await this.db.one(`SELECT 1 FROM olympiad_venue WHERE id = $1 AND olympiad_id = $2`, [venueId, id]);
    if (!v) throw new NotFoundException({ error: 'NOT_FOUND' });
  }

  get webOrigin() {
    return this.config.webOrigin;
  }
}
