import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor } from '../authz';
import { NotifyService } from '../notify/notify.service';
import { CreateSeasonDto, PatchSeasonDto, PatchWaveDto, PatchSchoolDto, SchoolDto, UpsertWaveDto } from './seasons.dto';

/**
 * task.md § 6 (`seasons`) and § 8.5 (season manager): seasons, the wave
 * calendar per grade (8 windows a season), schools, and bulk reminders.
 *
 * The schema carries the hard rules and this service turns their refusals into
 * named errors: INV-14 (windows of a grade never overlap; a wave points only at
 * a frozen monitoring form of its grade).
 */
@Injectable()
export class SeasonsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------- seasons

  async seasons() {
    const seasons = await this.db.query<Record<string, unknown> & { id: string }>(
      `SELECT id, code, name_uz AS "nameUz", name_ru AS "nameRu",
              starts_on::text AS "startsOn", ends_on::text AS "endsOn", is_current AS "isCurrent"
         FROM season ORDER BY starts_on DESC`,
    );
    return seasons;
  }

  async createSeason(actor: Actor, dto: CreateSeasonDto) {
    if (dto.endsOn <= dto.startsOn) throw new BadRequestException({ error: 'SEASON_WINDOW' });
    try {
      const row = await this.db.transaction(async (client) => {
        if (dto.makeCurrent) await client.query(`UPDATE season SET is_current = false WHERE is_current`);
        const r = await client.query<{ id: string }>(
          `INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on, is_current)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [dto.code, dto.nameUz.trim(), dto.nameRu.trim(), dto.startsOn, dto.endsOn, !!dto.makeCurrent],
        );
        return r.rows[0];
      });
      await this.audit.write({ action: 'season.created', personId: actor.personId, payload: { seasonId: row.id, season: dto.code } });
      return this.seasons();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'SEASON_EXISTS' });
      throw err;
    }
  }

  async patchSeason(actor: Actor, id: string, dto: PatchSeasonDto) {
    const rows = await this.db.query(
      `UPDATE season SET name_uz = COALESCE($2, name_uz), name_ru = COALESCE($3, name_ru),
                         starts_on = COALESCE($4::date, starts_on), ends_on = COALESCE($5::date, ends_on)
        WHERE id = $1 RETURNING id`,
      [id, dto.nameUz ?? null, dto.nameRu ?? null, dto.startsOn ?? null, dto.endsOn ?? null],
    ).catch((err: { code?: string }) => {
      if (err.code === '23514') throw new BadRequestException({ error: 'SEASON_WINDOW' });
      throw err;
    });
    if (!rows.length) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.audit.write({ action: 'season.updated', personId: actor.personId, payload: { seasonId: id } });
    return this.seasons();
  }

  /** Exactly one current season (`season_one_current`): switch in one transaction. */
  async makeCurrent(actor: Actor, id: string) {
    await this.db.transaction(async (client) => {
      const exists = await client.query(`SELECT 1 FROM season WHERE id = $1`, [id]);
      if (!exists.rowCount) throw new NotFoundException({ error: 'NOT_FOUND' });
      await client.query(`UPDATE season SET is_current = false WHERE is_current AND id <> $1`, [id]);
      await client.query(`UPDATE season SET is_current = true WHERE id = $1`, [id]);
    });
    await this.audit.write({ action: 'season.updated', personId: actor.personId, payload: { seasonId: id, current: true } });
    return this.seasons();
  }

  // --------------------------------------------------------------- waves

  /** The calendar: every wave of a season (default: current), with progress counts. */
  async waves(q: { seasonId?: string; grade?: number }) {
    const season = q.seasonId
      ? await this.db.one<{ id: string }>(`SELECT id FROM season WHERE id = $1`, [q.seasonId])
      : await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) return { seasonId: null, waves: [] };
    const waves = await this.db.query(
      `SELECT w.id, w.grade, w.ordinal, w.opens_at AS "opensAt", w.closes_at AS "closesAt",
              w.closed_at AS "closedAt", w.form_id AS "formId", f.label AS "formLabel",
              CASE WHEN w.closed_at IS NOT NULL OR w.closes_at <= now() THEN 'closed'
                   WHEN w.opens_at <= now() THEN 'open' ELSE 'upcoming' END AS state,
              (SELECT count(*)::int FROM session s WHERE s.wave_id = w.id AND s.status = 'submitted') AS submitted,
              (SELECT count(*)::int FROM session s WHERE s.wave_id = w.id AND s.status = 'started') AS "inProgress",
              (SELECT count(*)::int FROM enrolment e JOIN child c ON c.id = e.child_id
                WHERE e.ended_at IS NULL AND e.grade = w.grade AND c.anonymised_at IS NULL) AS eligible
         FROM wave w LEFT JOIN form f ON f.id = w.form_id
        WHERE w.season_id = $1 AND ($2::smallint IS NULL OR w.grade = $2)
        ORDER BY w.grade, w.ordinal`,
      [season.id, q.grade ?? null],
    );
    return { seasonId: season.id, waves };
  }

  /** Frozen monitoring forms a grade's wave may point at (INV-14). */
  async formsFor(grade: number) {
    return this.db.query(
      `SELECT f.id, f.label, f.frozen_at AS "frozenAt",
              (SELECT count(*)::int FROM form_item fi WHERE fi.form_id = f.id) AS positions,
              (SELECT array_agg(w.ordinal ORDER BY w.ordinal) FROM wave w WHERE w.form_id = f.id) AS "usedByWaves"
         FROM form f
        WHERE f.mode = 'monitoring' AND f.grade = $1 AND f.frozen_at IS NOT NULL
        ORDER BY f.frozen_at DESC`,
      [grade],
    );
  }

  /**
   * Sets wave N of a grade: creates it, or moves it while it has not opened.
   * Once a wave is open, its start and its form are history; only its close
   * may move (later, to give children more time).
   */
  async upsertWave(actor: Actor, dto: UpsertWaveDto) {
    const season = dto.seasonId
      ? await this.db.one<{ id: string }>(`SELECT id FROM season WHERE id = $1`, [dto.seasonId])
      : await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) throw new BadRequestException({ error: 'NO_SEASON' });
    if (dto.closesAt <= dto.opensAt) throw new BadRequestException({ error: 'WAVE_WINDOW' });

    const existing = await this.db.one<{ id: string; opens_at: Date }>(
      `SELECT id, opens_at FROM wave WHERE season_id = $1 AND grade = $2 AND ordinal = $3`,
      [season.id, dto.grade, dto.ordinal],
    );
    if (existing && existing.opens_at.getTime() <= Date.now()) {
      throw new ConflictException({ error: 'WAVE_STARTED', message: 'An open wave can only be extended.' });
    }

    const id = await this.write(async () => {
      if (existing) {
        await this.db.query(
          `UPDATE wave SET opens_at = $2, closes_at = $3, form_id = $4 WHERE id = $1`,
          [existing.id, dto.opensAt, dto.closesAt, dto.formId ?? null],
        );
        return existing.id;
      }
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO wave (season_id, grade, ordinal, opens_at, closes_at, form_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [season.id, dto.grade, dto.ordinal, dto.opensAt, dto.closesAt, dto.formId ?? null],
      );
      return row!.id;
    });

    await this.audit.write({
      action: existing ? 'wave.updated' : 'wave.created',
      personId: actor.personId,
      payload: { waveId: id, grade: dto.grade, ordinal: dto.ordinal, formId: dto.formId ?? null },
    });
    return this.wave(id);
  }

  async patchWave(actor: Actor, id: string, dto: PatchWaveDto) {
    const w = await this.db.one<{ opens_at: Date; closes_at: Date; closed_at: Date | null; form_id: string | null }>(
      `SELECT opens_at, closes_at, closed_at, form_id FROM wave WHERE id = $1`,
      [id],
    );
    if (!w) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (w.closed_at) throw new ConflictException({ error: 'WAVE_CLOSED' });
    const started = w.opens_at.getTime() <= Date.now();
    if (started) {
      // History is fixed: the start and the form children already took.
      if (dto.opensAt || dto.formId !== undefined) throw new ConflictException({ error: 'WAVE_STARTED' });
      if (dto.closesAt && new Date(dto.closesAt) < w.closes_at) {
        throw new ConflictException({ error: 'WAVE_STARTED', message: 'An open wave can only be extended.' });
      }
    }
    await this.write(() =>
      this.db.query(
        `UPDATE wave SET opens_at = COALESCE($2::timestamptz, opens_at), closes_at = COALESCE($3::timestamptz, closes_at),
                         form_id = CASE WHEN $5 THEN $4::uuid ELSE form_id END
          WHERE id = $1`,
        [id, dto.opensAt ?? null, dto.closesAt ?? null, dto.formId ?? null, dto.formId !== undefined],
      ),
    );
    await this.audit.write({ action: 'wave.updated', personId: actor.personId, payload: { waveId: id } });
    return this.wave(id);
  }

  /**
   * "Sends bulk wave reminders to parents" (§ 8.5) — to the OWNER of every
   * child in the wave's grade who has not taken it. § 10: never a child, at most
   * one reminder per wave per child per day (the throttle key makes the second
   * one a no-op), and only children whose data-processing consent is live.
   */
  async remind(actor: Actor, waveId: string) {
    const wave = await this.db.one<{ grade: number; ordinal: number; closes_at: Date; open: boolean }>(
      `SELECT grade, ordinal, closes_at, (opens_at <= now() AND closes_at > now() AND closed_at IS NULL) AS open
         FROM wave WHERE id = $1`,
      [waveId],
    );
    if (!wave) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (!wave.open) throw new ConflictException({ error: 'WAVE_NOT_OPEN' });

    const targets = await this.db.query<{ child_id: string; owner_id: string; name: string }>(
      `SELECT c.id AS child_id, g.person_id AS owner_id, c.given_name AS name
         FROM enrolment e
         JOIN child c ON c.id = e.child_id AND c.anonymised_at IS NULL
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE e.ended_at IS NULL AND e.grade = $2
          AND EXISTS (SELECT 1 FROM consent k WHERE k.child_id = c.id
                       AND k.type = 'data_processing' AND k.revoked_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM session s WHERE s.child_id = c.id AND s.wave_id = $1
                           AND s.status = 'submitted')`,
      [waveId, wave.grade],
    );
    const day = new Date().toISOString().slice(0, 10);
    let queued = 0;
    for (const t of targets) {
      const id = await this.notify.queue({
        personId: t.owner_id,
        template: 'wave_reminder',
        vars: {
          child: t.name,
          wave: `${wave.ordinal}-monitoring`,
          closes: wave.closes_at.toISOString(),
          link: `${this.config.webOrigin}/uz/family/children/${t.child_id}`,
        },
        throttleKey: `wave_reminder:${waveId}:${t.child_id}:${day}`,
      });
      if (id) queued += 1;
    }
    await this.audit.write({
      action: 'wave.reminders_sent',
      personId: actor.personId,
      payload: { waveId, eligible: targets.length, queued },
    });
    return { eligible: targets.length, queued, throttled: targets.length - queued };
  }

  // ------------------------------------------------------------- schools

  async schools(regionId: number, q?: string) {
    return this.db.query(
      `SELECT s.id, s.region_id AS "regionId", s.kind, s.name, s.district,
              (SELECT count(*)::int FROM enrolment e WHERE e.school_id = s.id AND e.ended_at IS NULL) AS pupils
         FROM school s
        WHERE s.region_id = $1 AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%')
        ORDER BY s.name LIMIT 500`,
      [regionId, q?.trim() || null],
    );
  }

  async createSchool(actor: Actor, dto: SchoolDto) {
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO school (region_id, kind, name, district) VALUES ($1, $2, $3, $4) RETURNING id`,
      [dto.regionId, dto.kind, dto.name.trim(), dto.district?.trim() || null],
    );
    await this.audit.write({ action: 'school.changed', personId: actor.personId, payload: { schoolId: row!.id, change: 'created' } });
    return this.schools(dto.regionId);
  }

  /** A school's region never changes: enrolments and cohorts were built on it. */
  async patchSchool(actor: Actor, id: string, dto: PatchSchoolDto) {
    const row = await this.db.one<{ region_id: number }>(
      `UPDATE school SET kind = COALESCE($2::school_kind, kind), name = COALESCE($3, name),
                         district = COALESCE($4, district)
        WHERE id = $1 RETURNING region_id`,
      [id, dto.kind ?? null, dto.name?.trim() || null, dto.district?.trim() ?? null],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.audit.write({ action: 'school.changed', personId: actor.personId, payload: { schoolId: id, change: 'updated' } });
    return this.schools(row.region_id);
  }

  // ------------------------------------------------------------- helpers

  private async wave(id: string) {
    const all = await this.db.one<{ season_id: string; grade: number }>(`SELECT season_id, grade FROM wave WHERE id = $1`, [id]);
    const list = await this.waves({ seasonId: all!.season_id, grade: all!.grade });
    return list.waves.find((w) => (w as { id: string }).id === id);
  }

  /** The schema's refusals, as named errors. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === '23P01') throw new ConflictException({ error: 'WAVE_OVERLAP', message: 'Windows of one grade cannot overlap (INV-14).' });
      if (e.code === '23505') throw new ConflictException({ error: 'WAVE_EXISTS' });
      if (e.code === '23514') throw new BadRequestException({ error: 'WAVE_WINDOW' });
      if (e.code === '23001') {
        // wave_needs_frozen_form: wrong mode, wrong grade, or not frozen.
        throw new BadRequestException({ error: 'WAVE_FORM_INVALID', message: e.message });
      }
      throw err;
    }
  }
}
