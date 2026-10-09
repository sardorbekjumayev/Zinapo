import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { NotifyService } from '../notify/notify.service';
import { Template } from '../notify/notify.types';

/**
 * task.md § 8.1.5: "Every change is notified via Telegram" — and the design's
 * change log says to whom: the owner and every co-guardian (design/06, "Every
 * change is sent to you and to Rustam Karimov").
 *
 * One place that knows who "the family" of a child is, so no call site has to
 * remember to include the co-guardians.
 */
@Injectable()
export class FamilyNotifier {
  constructor(
    private readonly db: DbService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Queues `template` to every live guardian of the child. Pass `client` to
   * join the caller's transaction, so a rolled-back change is never announced.
   */
  async guardians(
    childId: string,
    template: Template,
    vars: Record<string, string | number>,
    client?: PoolClient,
  ): Promise<void> {
    const sql = `SELECT g.person_id FROM guardianship g
                  WHERE g.child_id = $1 AND g.revoked_at IS NULL`;
    const rows = client
      ? (await client.query<{ person_id: string }>(sql, [childId])).rows
      : await this.db.query<{ person_id: string }>(sql, [childId]);

    for (const row of rows) {
      await this.notify.queue({ personId: row.person_id, template, vars }, client);
    }
  }

  /** "Madina Karimova" — the name every family message uses. */
  async childName(childId: string, client?: PoolClient): Promise<string> {
    const sql = `SELECT given_name || ' ' || family_name AS name FROM child WHERE id = $1`;
    const rows = client
      ? (await client.query<{ name: string }>(sql, [childId])).rows
      : await this.db.query<{ name: string }>(sql, [childId]);
    return rows[0]?.name ?? '';
  }

  async personName(personId: string, client?: PoolClient): Promise<string> {
    const sql = `SELECT full_name FROM person WHERE id = $1`;
    const rows = client
      ? (await client.query<{ full_name: string }>(sql, [personId])).rows
      : await this.db.query<{ full_name: string }>(sql, [personId]);
    return rows[0]?.full_name ?? '';
  }
}
