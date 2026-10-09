import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';

/**
 * task.md § 1.15: everything that changes access, consent, ownership, items or
 * flags writes to `audit_log`.
 *
 * The union is closed on purpose. Adding a line here is the moment to ask "does
 * this payload contain a PINFL, a code or a token?" — because none of them may
 * ever reach this table (task.md § 11, INV-06).
 */
export type AuditAction =
  // Sign-in
  | 'auth.start'
  | 'auth.tg_linked'
  | 'auth.phone_mismatch'
  | 'auth.code_issued'
  | 'auth.verify_failed'
  | 'auth.locked'
  | 'auth.cancelled'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.telegram_unlinked'
  // Me & workspaces
  | 'me.profile_updated'
  | 'me.workspace_switched'
  // Identity: children, guardians, ownership, consent, privacy
  | 'child.created'
  | 'child.updated'
  | 'child.enrolment_added'
  | 'child.duplicate_attempt'
  | 'child.fifth_child_review'
  | 'child.dispute_confirmed'
  | 'guardian.invited'
  | 'guardian.invite_accepted'
  | 'guardian.invite_declined'
  | 'guardian.invite_cancelled'
  | 'guardian.removed'
  | 'ownership.transfer_offered'
  | 'ownership.transfer_cancelled'
  | 'ownership.transferred'
  | 'consent.given'
  | 'consent.revoked'
  | 'privacy.anonymisation_requested'
  | 'privacy.anonymisation_cancelled'
  | 'privacy.anonymisation_executed'
  // Educator access
  | 'educator.applied'
  | 'educator.decided'
  | 'educator.invites_sent'
  | 'educator.match_check'
  | 'access.requested'
  | 'access.granted'
  | 'access.declined'
  | 'access.revoked'
  | 'access.suspended'
  | 'access.restored'
  // Item bank and forms
  | 'taxonomy.changed'
  | 'media.uploaded'
  | 'item.created'
  | 'item.updated'
  | 'item.version_created'
  | 'item.submitted'
  | 'item.reviewed'
  | 'item.approved'
  | 'item.retired'
  | 'item.anchor_set'
  | 'item_version.frozen'
  | 'form.created'
  | 'form.updated'
  | 'form.frozen'
  | 'calibration.run_started'
  | 'calibration.run_switched'
  // Seasons and sessions
  | 'season.created'
  | 'season.updated'
  | 'wave.created'
  | 'wave.updated'
  | 'wave.closed'
  | 'wave.reminders_sent'
  | 'school.changed'
  | 'session.started'
  | 'session.resumed'
  | 'session.submitted'
  | 'session.expired'
  // Olympiad
  | 'olympiad.registered'
  | 'olympiad.checked_in'
  | 'olympiad.results_published'
  // Trust & safety
  | 'flag.raised'
  | 'case.opened'
  | 'case.assigned'
  | 'case.resolved'
  // Outcomes and admin
  | 'outcome.imported'
  | 'staff_role.granted'
  | 'staff_role.revoked'
  | 'support.person_looked_up';

export interface AuditEntry {
  action: AuditAction;
  personId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /** Payload keys that must never be persisted, whatever the caller passes. */
  private static readonly FORBIDDEN = /pinfl|code|token|secret|password|otp/i;

  constructor(private readonly db: DbService) {}

  /**
   * Fire-and-forget: an audit write must never break the flow that triggered
   * it. Codes and tokens must not be passed in `payload` — `scrub` drops them
   * rather than trusting every caller to remember.
   */
  async write(entry: AuditEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_log (person_id, action, payload, ip, user_agent)
         VALUES ($1, $2, $3::jsonb, $4::inet, $5)`,
        [
          entry.personId ?? null,
          entry.action,
          JSON.stringify(AuditService.scrub(entry.payload ?? {})),
          entry.ip || null,
          entry.userAgent ?? null,
        ],
      );
    } catch (err) {
      this.logger.error(`audit write failed for ${entry.action}`, err as Error);
    }
  }

  /**
   * INV-06 and task.md § 11. A key that looks like a secret is replaced, not
   * removed, so a reviewer reading the log can see that something was stripped.
   *
   * `public_code` and `rule_code` are deliberately allowed — they are not
   * secrets and they are the whole point of the rows that carry them.
   */
  private static scrub(payload: Record<string, unknown>): Record<string, unknown> {
    const allow = /^(public_code|publicCode|rule_code|ruleCode|locale|error_code|errorCode)$/;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!allow.test(key) && AuditService.FORBIDDEN.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? AuditService.scrub(value as Record<string, unknown>)
          : value;
    }
    return out;
  }
}
