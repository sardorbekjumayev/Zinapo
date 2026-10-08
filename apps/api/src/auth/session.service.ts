import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AppConfig, CONFIG } from '../config/configuration';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { randomToken } from '../common/crypto.util';
import { Lang } from './login-request.types';
// Pure types and one pure function — no DI, so no module cycle with authz.
import { EducatorStatus, StaffRole, Workspace, isStaffRole, workspacesOf } from '../authz/actor';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PersonRow {
  id: string;
  full_name: string;
  phone: string;
  locale: string;
}

function refreshHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The phone is the account key (signin.md § 6). A Telegram account already
   * linked elsewhere is unlinked from the old person and moved here.
   */
  async upsertPerson(input: {
    phone: string;
    lang: Lang;
    telegramUserId: number;
    firstName: string | null;
    lastName: string | null;
  }): Promise<{ person: PersonRow; isNewUser: boolean }> {
    const fullName =
      [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'Zinapo foydalanuvchisi';

    return this.db.transaction(async (client) => {
      const stolen = await client.query<{ id: string }>(
        `UPDATE person SET telegram_user_id = NULL, updated_at = now()
         WHERE telegram_user_id = $1 AND phone <> $2
         RETURNING id`,
        [input.telegramUserId, input.phone],
      );
      for (const row of stolen.rows) {
        await this.audit.write({
          action: 'auth.telegram_unlinked',
          personId: row.id,
          payload: { reason: 'relinked_to_other_phone' },
        });
      }

      const existing = await client.query<PersonRow>(
        `SELECT id, full_name, phone, locale FROM person WHERE phone = $1`,
        [input.phone],
      );

      if (existing.rowCount && existing.rows[0]) {
        const updated = await client.query<PersonRow>(
          `UPDATE person
             SET phone_verified_at = now(),
                 verified_via      = 'telegram_contact',
                 telegram_user_id  = $2,
                 updated_at        = now()
           WHERE id = $1
           RETURNING id, full_name, phone, locale`,
          [existing.rows[0].id, input.telegramUserId],
        );
        return { person: updated.rows[0], isNewUser: false };
      }

      const created = await client.query<PersonRow>(
        `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via, telegram_user_id)
         VALUES ($1, $2, $3, now(), 'telegram_contact', $4)
         RETURNING id, full_name, phone, locale`,
        [fullName, input.phone, input.lang, input.telegramUserId],
      );
      return { person: created.rows[0], isNewUser: true };
    });
  }

  /**
   * The claims Next.js `middleware.ts` needs to gate a workspace segment
   * without a round trip to the API (task.md § 7): `ws` is the list of
   * workspaces, `sr` the staff roles.
   *
   * They are a 15-minute snapshot, which is why the API checks again on every
   * request. The middleware only decides which shell to render; the data is
   * always authorised server-side.
   */
  private async claimsFor(personId: string): Promise<{ ws: Workspace[]; sr: StaffRole[] }> {
    const row = await this.db.one<{
      staff_roles: string[] | null;
      educator_status: EducatorStatus | null;
      owner_of: string;
      co_guardian_of: string;
    }>(
      // `role::text` — node-pg cannot parse the `staff_role[]` array type and
      // would hand back the literal string '{bank_editor}'.
      `SELECT
         (SELECT array_agg(role::text ORDER BY role) FROM staff_role_assignment
           WHERE person_id = $1 AND revoked_at IS NULL)                 AS staff_roles,
         (SELECT status FROM educator_profile WHERE person_id = $1)     AS educator_status,
         (SELECT count(*) FROM guardianship
           WHERE person_id = $1 AND revoked_at IS NULL AND role = 'owner')       AS owner_of,
         (SELECT count(*) FROM guardianship
           WHERE person_id = $1 AND revoked_at IS NULL AND role = 'co_guardian') AS co_guardian_of`,
      [personId],
    );

    const staffRoles = (row?.staff_roles ?? []).filter(isStaffRole);
    return {
      ws: workspacesOf({
        personId,
        staffRoles,
        educatorStatus: row?.educator_status ?? null,
        ownerOf: Number(row?.owner_of ?? 0),
        coGuardianOf: Number(row?.co_guardian_of ?? 0),
        lastWorkspace: null,
      }),
      sr: staffRoles,
    };
  }

  async issue(
    personId: string,
    meta: { ua: string; ip: string },
  ): Promise<SessionTokens> {
    const claims = await this.claimsFor(personId);
    const accessToken = await this.jwt.signAsync(
      { sub: personId, ...claims },
      { secret: this.config.jwtAccessSecret, expiresIn: ACCESS_TTL_SEC },
    );
    const refreshToken = randomToken(32);

    await this.db.query(
      `INSERT INTO auth_session (person_id, refresh_token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4::inet, now() + ($5 || ' seconds')::interval)`,
      [personId, refreshHash(refreshToken), meta.ua, meta.ip || null, String(REFRESH_TTL_SEC)],
    );

    return { accessToken, refreshToken };
  }

  /** Single-use refresh: the old row is revoked in the same statement that reads it. */
  async rotate(refreshToken: string, meta: { ua: string; ip: string }): Promise<SessionTokens & { personId: string }> {
    const row = await this.db.one<{ person_id: string }>(
      `UPDATE auth_session
          SET revoked_at = now(), last_used_at = now()
        WHERE refresh_token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING person_id`,
      [refreshHash(refreshToken)],
    );
    if (!row) throw new UnauthorizedException({ error: 'REFRESH_INVALID' });

    const tokens = await this.issue(row.person_id, meta);
    return { ...tokens, personId: row.person_id };
  }

  async revoke(refreshToken: string): Promise<string | null> {
    const row = await this.db.one<{ person_id: string }>(
      `UPDATE auth_session SET revoked_at = now()
        WHERE refresh_token_hash = $1 AND revoked_at IS NULL
        RETURNING person_id`,
      [refreshHash(refreshToken)],
    );
    return row?.person_id ?? null;
  }

  async verifyAccessToken(token: string): Promise<{ sub: string; ws?: Workspace[]; sr?: StaffRole[] }> {
    return this.jwt.verifyAsync<{ sub: string; ws?: Workspace[]; sr?: StaffRole[] }>(token, {
      secret: this.config.jwtAccessSecret,
    });
  }

  async findPerson(id: string): Promise<PersonRow | null> {
    return this.db.one<PersonRow>(
      `SELECT id, full_name, phone, locale FROM person WHERE id = $1`,
      [id],
    );
  }
}
