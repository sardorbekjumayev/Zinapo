import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { PinflService } from '../identity/pinfl.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ROWS = 50_000;
const REQUIRED = ['pinfl', 'family_name', 'given_name', 'admitted', 'year'] as const;

/** A child's name as the outcomes operator sees a candidate: "KARIMOVA M***A". */
const mask = (given: string, family: string) => {
  const g = given.trim();
  return `${family.trim().toUpperCase()} ${g.length <= 2 ? `${g[0] ?? ''}***` : `${g[0]}***${g[g.length - 1]}`}`.toUpperCase();
};

/** RFC-4180-ish: commas or semicolons, quotes with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const delim = (text.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const YES = new Set(['yes', 'y', '1', 'true', 'ha', 'да', 'admitted', 'qabul']);
const NO = new Set(['no', 'n', '0', 'false', "yo'q", 'yoq', 'yoʻq', 'нет', 'rejected']);

/**
 * § 8.5 "Outcomes operator" — the July admission lists (decided with the
 * product owner, task.md note M9-b).
 *
 * The CSV carries PINFLs; matching happens HERE, by the same keyed hash
 * `child.pinfl_hash` uses (INV-06). The PINFL is never stored, logged,
 * returned or shown — only its hash (so a child registered later still
 * matches) and the date of birth it encodes (so a person can review the
 * rows that did not match). Every response from this service is PINFL-free.
 */
@Injectable()
export class OutcomesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly pinfl: PinflService,
  ) {}

  async import(actor: Actor, fileName: string, csv: string) {
    const rows = parseCsv(csv);
    if (rows.length < 1) throw new BadRequestException({ error: 'CSV_EMPTY' });
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length) throw new BadRequestException({ error: 'CSV_COLUMNS', details: { missing } });
    if (rows.length - 1 > MAX_ROWS) throw new BadRequestException({ error: 'CSV_TOO_LARGE', details: { max: MAX_ROWS } });
    const at = (r: string[], c: string) => (r[header.indexOf(c)] ?? '').trim();

    // Rows that already match a child registered since an earlier import.
    await this.rematch();

    const invalid: { line: number; reason: string }[] = [];
    let matched = 0;
    let unmatched = 0;
    const years = new Set<number>();
    const importId = (
      await this.db.one<{ id: string }>(
        `INSERT INTO outcome_import (file_name, admit_year, imported_by) VALUES ($1, $2, $3) RETURNING id`,
        [fileName.slice(0, 200), new Date().getUTCFullYear(), actor.personId],
      )
    )!.id;

    await this.db.transaction(async (client) => {
      for (let n = 1; n < rows.length; n++) {
        const r = rows[n];
        const line = n + 1;
        const pinfl = at(r, 'pinfl').replace(/\s/g, '');
        if (!PinflService.isWellFormed(pinfl)) {
          invalid.push({ line, reason: 'PINFL_INVALID' });
          continue;
        }
        const admittedRaw = at(r, 'admitted').toLowerCase();
        const admitted = YES.has(admittedRaw) ? true : NO.has(admittedRaw) ? false : null;
        if (admitted === null) {
          invalid.push({ line, reason: 'ADMITTED_INVALID' });
          continue;
        }
        const year = Number(at(r, 'year'));
        if (!Number.isInteger(year) || year < 2020 || year > 2100) {
          invalid.push({ line, reason: 'YEAR_INVALID' });
          continue;
        }
        years.add(year);
        const hash = this.pinfl.hash(pinfl);
        const dob = PinflService.encodedDob(pinfl)!.toISOString().slice(0, 10);
        const schoolName = header.includes('school') ? at(r, 'school') : '';
        const school = schoolName
          ? await client.query<{ id: string }>(`SELECT id FROM school WHERE lower(name) = lower($1) LIMIT 1`, [schoolName])
          : null;
        const child = await client.query<{ id: string }>(
          `SELECT id FROM child WHERE pinfl_hash = $1 AND anonymised_at IS NULL`,
          [hash],
        );
        const childId = child.rows[0]?.id ?? null;
        const source = {
          line,
          familyName: at(r, 'family_name').slice(0, 80),
          givenName: at(r, 'given_name').slice(0, 80),
          school: schoolName.slice(0, 200) || null,
          dob,
        };
        try {
          await client.query('SAVEPOINT row');
          await client.query(
            `INSERT INTO admission_outcome (child_id, admit_year, school_id, admitted, source_row, import_id, pinfl_hash, review, matched_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, CASE WHEN $1::uuid IS NULL THEN 'pending' ELSE 'matched_auto' END,
                     CASE WHEN $1::uuid IS NULL THEN NULL ELSE now() END)
             ON CONFLICT (pinfl_hash, admit_year) WHERE pinfl_hash IS NOT NULL DO UPDATE
                SET admitted = EXCLUDED.admitted, school_id = EXCLUDED.school_id, source_row = EXCLUDED.source_row,
                    import_id = EXCLUDED.import_id,
                    child_id = COALESCE(admission_outcome.child_id, EXCLUDED.child_id),
                    review = CASE WHEN admission_outcome.review IN ('matched_manual', 'not_zinapo') THEN admission_outcome.review
                                  WHEN COALESCE(admission_outcome.child_id, EXCLUDED.child_id) IS NOT NULL THEN 'matched_auto'
                                  ELSE 'pending' END,
                    matched_at = COALESCE(admission_outcome.matched_at, EXCLUDED.matched_at)`,
            [childId, year, school?.rows[0]?.id ?? null, admitted, JSON.stringify(source), importId, hash],
          );
          await client.query('RELEASE SAVEPOINT row');
          if (childId) matched += 1;
          else unmatched += 1;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT row');
          // (child, year) already holds an outcome from a different row.
          if ((err as { code?: string }).code === '23505') invalid.push({ line, reason: 'DUPLICATE_CHILD_YEAR' });
          else throw err;
        }
      }
      await client.query(
        `UPDATE outcome_import SET rows = $2, matched = $3, unmatched = $4, invalid = $5,
                admit_year = COALESCE($6, admit_year) WHERE id = $1`,
        [importId, rows.length - 1, matched, unmatched, invalid.length, years.size === 1 ? [...years][0] : null],
      );
    });
    await this.audit.write({
      action: 'outcome.imported',
      personId: actor.personId,
      payload: { importId, rows: rows.length - 1, matched, unmatched, invalid: invalid.length },
    });
    return { importId, rows: rows.length - 1, matched, unmatched, invalid };
  }

  /** A child who registered after the import: their row matches now, by hash. */
  async rematch(): Promise<number> {
    const r = await this.db.query(
      `UPDATE admission_outcome ao SET child_id = c.id, review = 'matched_auto', matched_at = now()
         FROM child c
        WHERE ao.review = 'pending' AND ao.child_id IS NULL AND ao.pinfl_hash = c.pinfl_hash AND c.anonymised_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM admission_outcome x WHERE x.child_id = c.id AND x.admit_year = ao.admit_year)
        RETURNING ao.id`,
    );
    return r.length;
  }

  /**
   * The outcomes page: imports, counts, and the check the lists exist for —
   * the admission rate by the child's last band (does the measurement predict
   * admission?). Counts only; no child is listed.
   */
  async summary(year?: number) {
    const imports = await this.db.query(
      `SELECT i.id, i.file_name AS "fileName", i.admit_year AS "admitYear", i.imported_at AS "importedAt", p.full_name AS "importedBy",
              i.rows, i.matched, i.unmatched, i.invalid
         FROM outcome_import i JOIN person p ON p.id = i.imported_by
        WHERE $1::smallint IS NULL OR i.admit_year = $1 ORDER BY i.imported_at DESC LIMIT 50`,
      [year ?? null],
    );
    const totals = await this.db.one(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE review IN ('matched_auto', 'matched_manual'))::int AS matched,
              count(*) FILTER (WHERE review = 'pending')::int AS pending,
              count(*) FILTER (WHERE review = 'not_zinapo')::int AS "notZinapo",
              count(*) FILTER (WHERE admitted)::int AS admitted
         FROM admission_outcome WHERE $1::smallint IS NULL OR admit_year = $1`,
      [year ?? null],
    );
    const byBand = await this.db.query<{ bucket: string; children: number; admitted: number }>(
      `WITH last AS (
         SELECT DISTINCT ON (b.child_id) b.child_id, 100 - (b.pct_low + b.pct_high) / 2.0 AS top
           FROM percentile_band b JOIN calibration_run r ON r.id = b.calibration_run_id AND r.is_current
           JOIN wave w ON w.id = b.wave_id
          WHERE b.pct_low IS NOT NULL
          ORDER BY b.child_id, w.closes_at DESC)
       SELECT CASE WHEN l.top IS NULL THEN 'none' WHEN l.top <= 10 THEN 'top10' WHEN l.top <= 25 THEN 'top25'
                   WHEN l.top <= 50 THEN 'top50' ELSE 'rest' END AS bucket,
              count(*)::int AS children, count(*) FILTER (WHERE ao.admitted)::int AS admitted
         FROM admission_outcome ao LEFT JOIN last l ON l.child_id = ao.child_id
        WHERE ao.child_id IS NOT NULL AND ($1::smallint IS NULL OR ao.admit_year = $1)
        GROUP BY 1`,
      [year ?? null],
    );
    const order = ['top10', 'top25', 'top50', 'rest', 'none'];
    return {
      imports,
      totals,
      byBand: order.map((k) => {
        const b = byBand.find((x) => x.bucket === k);
        return { bucket: k, children: b?.children ?? 0, admitted: b?.admitted ?? 0, rate: b && b.children ? Number((b.admitted / b.children).toFixed(3)) : null };
      }),
    };
  }

  /** Rows waiting for a person: the names and date of birth from the official list — never the PINFL. */
  async pending(year?: number) {
    return this.db.query(
      `SELECT ao.id, ao.admit_year AS "admitYear", ao.admitted, ao.source_row->>'familyName' AS "familyName",
              ao.source_row->>'givenName' AS "givenName", ao.source_row->>'dob' AS dob,
              COALESCE(s.name, ao.source_row->>'school') AS school, (ao.source_row->>'line')::int AS line, ao.imported_at AS "importedAt"
         FROM admission_outcome ao LEFT JOIN school s ON s.id = ao.school_id
        WHERE ao.review = 'pending' AND ($1::smallint IS NULL OR ao.admit_year = $1)
        ORDER BY ao.imported_at DESC, (ao.source_row->>'line')::int LIMIT 500`,
      [year ?? null],
    );
  }

  /** Same date of birth, a similar family name — a person decides. Children shown masked. */
  async candidates(id: string) {
    const row = await this.row(id);
    const fam = String(row.source_row.familyName ?? '').toUpperCase();
    const kids = await this.db.query<{ id: string; given_name: string; family_name: string; dob: string; grade: number | null; region_uz: string | null; region_ru: string | null; same_name: boolean }>(
      `SELECT c.id, c.given_name, c.family_name, c.dob::text AS dob, e.grade, r.name_uz AS region_uz, r.name_ru AS region_ru,
              upper(c.family_name) = $2 AS same_name
         FROM child c
    LEFT JOIN LATERAL (SELECT grade, school_region_id FROM enrolment WHERE child_id = c.id AND ended_at IS NULL
                        ORDER BY school_year DESC LIMIT 1) e ON true
    LEFT JOIN region r ON r.id = e.school_region_id
        WHERE c.dob = $1::date AND c.anonymised_at IS NULL
          AND (upper(c.family_name) = $2 OR left(upper(c.family_name), 4) = left($2, 4))
          AND NOT EXISTS (SELECT 1 FROM admission_outcome x WHERE x.child_id = c.id AND x.admit_year = $3)
        ORDER BY same_name DESC, c.family_name LIMIT 10`,
      [row.source_row.dob, fam, row.admit_year],
    );
    return kids.map((k) => ({
      childId: k.id,
      name: mask(k.given_name, k.family_name),
      dob: k.dob,
      grade: k.grade,
      regionUz: k.region_uz,
      regionRu: k.region_ru,
      sameFamilyName: k.same_name,
    }));
  }

  /** A manual match must share the date of birth the PINFL encodes — the one hard check left. */
  async match(actor: Actor, id: string, childId: string) {
    const row = await this.row(id);
    if (row.review !== 'pending') throw new ConflictException({ error: 'ALREADY_REVIEWED' });
    const child = await this.db.one<{ dob: string }>(`SELECT dob::text AS dob FROM child WHERE id = $1 AND anonymised_at IS NULL`, [childId]);
    if (!child) throw new NotFoundException({ error: 'CHILD_NOT_FOUND' });
    if (child.dob !== row.source_row.dob) throw new ConflictException({ error: 'DOB_MISMATCH' });
    try {
      await this.db.query(
        `UPDATE admission_outcome SET child_id = $2, review = 'matched_manual', matched_at = now(), reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
        [id, childId, actor.personId],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'CHILD_ALREADY_HAS_OUTCOME' });
      throw err;
    }
    await this.audit.write({ action: 'outcome.imported', personId: actor.personId, payload: { outcomeId: id, manualMatch: true } });
    return { ok: true };
  }

  async notZinapo(actor: Actor, id: string) {
    const row = await this.row(id);
    if (row.review !== 'pending') throw new ConflictException({ error: 'ALREADY_REVIEWED' });
    await this.db.query(`UPDATE admission_outcome SET review = 'not_zinapo', reviewed_by = $2, reviewed_at = now() WHERE id = $1`, [id, actor.personId]);
    return { ok: true };
  }

  private async row(id: string) {
    if (!UUID.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const r = await this.db.one<{ review: string; admit_year: number; source_row: Record<string, unknown> }>(
      `SELECT review, admit_year, source_row FROM admission_outcome WHERE id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException({ error: 'NOT_FOUND' });
    return r;
  }
}
