/**
 * task.md § 10 — notification templates, uz and ru.
 *
 * Every template is listed here with its variables, because a template is a
 * promise to a parent: `access_granted` has to say *which* educator and *until
 * when*, or it is noise. The copy lives in `templates.uz.ts` / `templates.ru.ts`.
 */

export const TEMPLATES = [
  // Educator access
  'educator_invite',
  'access_requested',
  'access_granted',
  'access_revoked',
  'access_expiring',
  // Guardianship
  'co_guardian_invite',
  'ownership_transfer',
  'co_guardian_joined',
  'guardian_removed',
  'ownership_changed',
  // Consents and privacy (M2: "every change is notified")
  'consent_changed',
  'anonymisation_requested',
  'anonymisation_cancelled',
  'anonymisation_done',
  // To the educator, about their own access
  'educator_access_granted',
  'educator_access_ended',
  // Educator workspace (M6)
  'educator_application_decided',
  'practice_assigned',
  // Waves and reports
  'wave_open',
  'wave_reminder',
  'report_ready',
  // Olympiad
  'olympiad_registered',
  'final_venue_details',
  // Trust & safety
  'case_needs_owner_confirmation',
  // Item bank (to the author)
  'item_reviewed',
] as const;

export type Template = (typeof TEMPLATES)[number];

export type NotifyChannel = 'telegram' | 'sms';

export interface NotifyRequest {
  /** A registered person. Telegram first. */
  personId?: string | null;
  /** A number that is not registered yet — SMS only (bulk educator invites). */
  phone?: string | null;
  template: Template;
  vars: Record<string, string | number>;
  /**
   * task.md § 10: at most one wave reminder per child per day. Supplying a key
   * makes that a unique index rather than application bookkeeping — a second
   * attempt with the same key is silently dropped.
   */
  throttleKey?: string;
  /** Overrides the default channel choice. */
  channel?: NotifyChannel;
}

/**
 * The three hard rules from task.md § 10. They are checked in
 * `NotifyService.queue`, not left to call sites.
 *
 *   1. Never message a child.          — children have no person row to message.
 *   2. Never message a parent about an educator whose link expired.
 *   3. Throttle to one reminder per wave per child per day.
 */
export const EXPIRY_WARNING_DAYS = 14;
