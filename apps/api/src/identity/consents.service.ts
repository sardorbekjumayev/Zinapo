import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { CONSENT_DOCUMENT_VERSION } from './children.service';

export type ConsentType = 'data_processing' | 'third_party_transfer' | 'marketing';

export const CONSENT_TYPES: ConsentType[] = [
  'data_processing',
  'third_party_transfer',
  'marketing',
];

export interface ConsentState {
  type: ConsentType;
  required: boolean;
  given: boolean;
  documentVersion: string | null;
  givenAt: string | null;
  revokedAt: string | null;
}

/**
 * task.md § 8.2 and § 12 M2: three separate types, versioned documents,
 * revocable, and only the owner may change them (§ 3 — a co-guardian is
 * view-only).
 *
 * "Separate" is the load-bearing word. Granting `marketing` must not be a
 * condition of anything, and revoking it must not touch the other two — so
 * each type is its own row with its own lifecycle, not a flag on the child.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * All three types with their current state, including the ones never given —
   * the consents screen has to show a parent what they have NOT agreed to, not
   * just what they have.
   */
  async forChild(childId: string): Promise<ConsentState[]> {
    const rows = await this.db.query<{
      type: ConsentType;
      document_version: string;
      given_at: string;
      revoked_at: string | null;
    }>(
      `SELECT type, document_version, given_at, revoked_at
         FROM consent
        WHERE child_id = $1 AND revoked_at IS NULL`,
      [childId],
    );

    const live = new Map(rows.map((r) => [r.type, r]));
    return CONSENT_TYPES.map((type) => {
      const row = live.get(type);
      return {
        type,
        required: type === 'data_processing',
        given: !!row,
        documentVersion: row?.document_version ?? null,
        givenAt: row?.given_at ?? null,
        revokedAt: row?.revoked_at ?? null,
      };
    });
  }

  /**
   * Gives or revokes one consent.
   *
   * `data_processing` cannot be revoked here: without it there is no lawful
   * basis to keep the profile at all, so the honest action is anonymisation,
   * and `/family/privacy` is where that lives. Returns false so the caller can
   * point there rather than silently doing nothing.
   */
  async set(
    actor: Actor,
    childId: string,
    type: ConsentType,
    given: boolean,
  ): Promise<{ ok: boolean; reason?: 'use_anonymisation' }> {
    if (type === 'data_processing' && !given) {
      return { ok: false, reason: 'use_anonymisation' };
    }

    if (given) {
      await this.db.query(
        `INSERT INTO consent (child_id, person_id, type, document_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [childId, actor.personId, type, CONSENT_DOCUMENT_VERSION],
      );
    } else {
      await this.db.query(
        `UPDATE consent SET revoked_at = now()
          WHERE child_id = $1 AND type = $2 AND revoked_at IS NULL`,
        [childId, type],
      );
    }

    await this.audit.write({
      action: given ? 'consent.given' : 'consent.revoked',
      personId: actor.personId,
      payload: { childId, type, documentVersion: CONSENT_DOCUMENT_VERSION },
    });
    return { ok: true };
  }

  /** Every consent across the actor's children, for `/family/consents`. */
  async forActor(actor: Actor) {
    const children = await this.db.query<{ id: string; name: string }>(
      `SELECT c.id, c.given_name || ' ' || c.family_name AS name
         FROM guardianship g
         JOIN child c ON c.id = g.child_id
        WHERE g.person_id = $1 AND g.revoked_at IS NULL AND c.anonymised_at IS NULL
        ORDER BY c.dob`,
      [actor.personId],
    );

    return Promise.all(
      children.map(async (child) => ({
        childId: child.id,
        childName: child.name,
        consents: await this.forChild(child.id),
      })),
    );
  }
}
