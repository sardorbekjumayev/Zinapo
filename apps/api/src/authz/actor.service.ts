import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { Actor, EducatorStatus, StaffRole, Workspace, isStaffRole } from './actor';

const CACHE_TTL_SEC = 60; // task.md § 4

interface ActorRow {
  staff_roles: string[] | null;
  educator_status: EducatorStatus | null;
  owner_of: string;
  co_guardian_of: string;
  last_workspace: Workspace | null;
}

/**
 * Loads the Actor for a request: one query, cached 60 s in Redis.
 *
 * The query derives everything from relationships (INV-01) — there is no column
 * anywhere that says "this person is a parent".
 */
@Injectable()
export class ActorService {
  private readonly logger = new Logger(ActorService.name);

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  private key(personId: string): string {
    return `zn:actor:${personId}`;
  }

  async load(personId: string): Promise<Actor | null> {
    const cached = await this.readCache(personId);
    if (cached) return cached;

    const row = await this.db.one<ActorRow>(
      // `role::text` matters: node-pg has no parser registered for the
      // `staff_role[]` array type, so an un-cast array_agg comes back as the
      // literal string '{bank_editor}' instead of an array. Casting to text[]
      // uses the built-in parser.
      `SELECT
         (SELECT array_agg(sra.role::text ORDER BY sra.role)
            FROM staff_role_assignment sra
           WHERE sra.person_id = p.id AND sra.revoked_at IS NULL)        AS staff_roles,
         (SELECT ep.status FROM educator_profile ep WHERE ep.person_id = p.id) AS educator_status,
         (SELECT count(*) FROM guardianship g
           WHERE g.person_id = p.id AND g.revoked_at IS NULL AND g.role = 'owner')       AS owner_of,
         (SELECT count(*) FROM guardianship g
           WHERE g.person_id = p.id AND g.revoked_at IS NULL AND g.role = 'co_guardian') AS co_guardian_of,
         p.last_workspace
       FROM person p
      WHERE p.id = $1`,
      [personId],
    );
    if (!row) return null;

    const actor: Actor = {
      personId,
      // Filtered rather than cast: a role added to the SQL enum but not yet to
      // STAFF_ROLES would otherwise reach `STAFF_PERMISSIONS[role]` as
      // undefined and take the request down. Dropping it fails closed.
      staffRoles: (row.staff_roles ?? []).filter(isStaffRole),
      educatorStatus: row.educator_status,
      ownerOf: Number(row.owner_of),
      coGuardianOf: Number(row.co_guardian_of),
      lastWorkspace: row.last_workspace,
    };

    await this.writeCache(actor);
    return actor;
  }

  /**
   * Call this from every service that changes a relationship: granting a staff
   * role, deciding an educator application, adding or revoking a guardianship,
   * switching the workspace. A 60 s stale window is fine for reads and wrong
   * for "you now have access".
   */
  async invalidate(...personIds: (string | null | undefined)[]): Promise<void> {
    const keys = personIds.filter((id): id is string => !!id).map((id) => this.key(id));
    if (keys.length === 0) return;
    try {
      await this.redis.client.del(...keys);
    } catch (err) {
      // A cache that will not clear must not fail the write that triggered it;
      // the entry expires on its own within a minute.
      this.logger.warn(`actor cache invalidation failed: ${(err as Error).message}`);
    }
  }

  private async readCache(personId: string): Promise<Actor | null> {
    try {
      const raw = await this.redis.client.get(this.key(personId));
      return raw ? (JSON.parse(raw) as Actor) : null;
    } catch (err) {
      this.logger.warn(`actor cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async writeCache(actor: Actor): Promise<void> {
    try {
      await this.redis.client.set(
        this.key(actor.personId),
        JSON.stringify(actor),
        'EX',
        CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(`actor cache write failed: ${(err as Error).message}`);
    }
  }
}
