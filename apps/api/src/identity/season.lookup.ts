import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export interface CurrentSeason {
  id: string;
  code: string;
  /** `YYYY-MM-DD` */
  endsOn: string;
  /**
   * The default end of educator access: 31 May of the season's last year, or
   * the season end if that is earlier (design/06, "until 31 May 2027 ·
   * recommended").
   */
  schoolYearEnd: string;
}

/**
 * The season as M2 needs it: the window an educator's access may span, and the
 * period a decline blocks for (task.md § 8.1.5). Season administration itself
 * is M4.
 */
@Injectable()
export class SeasonLookup {
  constructor(private readonly db: DbService) {}

  async current(client?: PoolClient): Promise<CurrentSeason | null> {
    const sql = `SELECT id, code, ends_on::text AS ends_on FROM season WHERE is_current`;
    const rows = client
      ? (await client.query<{ id: string; code: string; ends_on: string }>(sql)).rows
      : await this.db.query<{ id: string; code: string; ends_on: string }>(sql);
    const row = rows[0];
    if (!row) return null;

    const may31 = `${row.ends_on.slice(0, 4)}-05-31`;
    return {
      id: row.id,
      code: row.code,
      endsOn: row.ends_on,
      schoolYearEnd: may31 < row.ends_on ? may31 : row.ends_on,
    };
  }
}

/**
 * The school year a new enrolment belongs to. The season runs September to
 * June, so anything from July onwards is the coming year — a parent adding a
 * child in August is enrolling them for the year about to start.
 */
export function currentSchoolYear(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
