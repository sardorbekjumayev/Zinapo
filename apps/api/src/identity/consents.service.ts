import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { CONSENT_DOCUMENT_VERSION } from './children.service';
import { FamilyNotifier } from './family-notifier.service';

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
  /** The document version of the live consent, or of the last one given. */
  documentVersion: string | null;
  givenAt: string | null;
  /** Set when the last consent of this type was withdrawn and none is live. */
  revokedAt: string | null;
  /** The version a new consent would be given against. */
  currentDocumentVersion: string;
}

/**
 * task.md § 8.1 and § 12 M2: three separate types, versioned documents,
 * revocable, and only the owner may change them (§ 3 — a co-guardian is
 * view-only).
 *
 * "Separate" is the load-bearing word. Granting `marketing` must not be a
 * condition of anything, and revoking it must not touch the other two — so
 * each type is its own row with its own lifecycle, not a flag on the child.
 *
 * Every grant is a new row and every withdrawal stamps `revoked_at`, so the
 * table is the history: which version was agreed to, when, and by whom.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly family: FamilyNotifier,
  ) {}

  /**
   * All three types with their current state, including the ones never given —
   * the consents screen has to show a parent what they have NOT agreed to, not
   * just what they have.
   */
  async forChild(childId: string): Promise<ConsentState[]> {
    // The latest row per type: the live one if any, otherwise the last revoked.
    const rows = await this.db.query<{
      type: ConsentType;
      document_version: string;
      given_at: string;
      revoked_at: string | null;
    }>(
      `SELECT DISTINCT ON (type) type, document_version, given_at, revoked_at
         FROM consent
        WHERE child_id = $1
        ORDER BY type, (revoked_at IS NULL) DESC, given_at DESC`,
      [childId],
    );

    const latest = new Map(rows.map((r) => [r.type, r]));
    return CONSENT_TYPES.map((type) => {
      const row = latest.get(type);
      const live = !!row && row.revoked_at === null;
      return {
        type,
        required: type === 'data_processing',
        given: live,
        documentVersion: row?.document_version ?? null,
        givenAt: row?.given_at ?? null,
        revokedAt: live ? null : (row?.revoked_at ?? null),
        currentDocumentVersion: CONSENT_DOCUMENT_VERSION,
      };
    });
  }

  /**
   * Gives or withdraws one consent. Idempotent: setting a state the consent is
   * already in changes nothing and announces nothing.
   *
   * `data_processing` CAN be withdrawn (design/06, "Withdraw anyway"): the
   * profile stays, measurement stops — M4 refuses a new session without it —
   * and earlier results are kept. Deleting the data is a separate, explicit
   * request on `/family/privacy`.
   */
  async set(
    actor: Actor,
    childId: string,
    type: ConsentType,
    given: boolean,
  ): Promise<ConsentState[]> {
    const changed = given
      ? await this.db.query(
          `INSERT INTO consent (child_id, person_id, type, document_version)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [childId, actor.personId, type, CONSENT_DOCUMENT_VERSION],
        )
      : await this.db.query(
          `UPDATE consent SET revoked_at = now()
            WHERE child_id = $1 AND type = $2 AND revoked_at IS NULL
            RETURNING id`,
          [childId, type],
        );

    if (changed.length > 0) {
      await this.audit.write({
        action: given ? 'consent.given' : 'consent.revoked',
        personId: actor.personId,
        payload: { childId, type, documentVersion: CONSENT_DOCUMENT_VERSION },
      });
      await this.family.guardians(childId, 'consent_changed', {
        child: await this.family.childName(childId),
        consent: type,
        given: given ? 1 : 0,
      });
    }
    return this.forChild(childId);
  }

  /** Every consent across the actor's children, for `/family/consents`. */
  async forActor(actor: Actor) {
    const children = await this.db.query<{ id: string; name: string; via: string }>(
      `SELECT c.id, c.given_name || ' ' || c.family_name AS name, g.role::text AS via
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
        canManage: child.via === 'owner',
        consents: await this.forChild(child.id),
      })),
    );
  }
}
