/**
 * M9 — measurement v1, outcomes, admin API contracts (task.md § 8.5, § 9).
 * Dates are ISO strings.
 *
 * Decided with the product owner (task.md notes M9-a … M9-d): Rasch v1 in the
 * API; a CSV admission list matched by PINFL hash inside the service with a
 * review queue; the final's inflation adjustment computed and applied (n ≥ 30);
 * a v1 run becomes current only when staff switch it.
 */

// ============================================================ calibration

/**
 * POST /api/staff/calibration-runs { method: 'raw_band_v0' | 'rasch_anchor_equating_v1', grade? } → 202 { runs: string[] }
 *   v1 runs are created NOT current (v0 runs still become current at once).
 * GET /api/staff/calibration-runs (lib/report-types.ts CalibrationRun) — `params` of a v1 run:
 */
export interface V1Params {
  model: 'rasch';
  estimation: 'jmle';
  band: string;
  persons: number;
  items: number;
  /** Anchors held at an earlier v1 run's difficulty (equating). 0 on a first run. */
  fixedAnchors: number;
  iterations: number;
  converged: boolean;
  /** Children whose proctored final could be placed on the scale. */
  finals: number;
  /** Per region: delta applied (≥ 30 pairs) or null with the pair count. */
  inflation: { regionId: number; delta: number | null; n: number }[];
  waves: Record<string, { sessions: number; reliability: number | null; sem: number }>;
}

/** GET /api/staff/calibration-runs/compare?a=&b= — same season and grade (409 NOT_COMPARABLE). No child is named. */
export interface RunComparison {
  a: { id: string; method: string; isCurrent: boolean; startedAt: string; params: Record<string, unknown> };
  b: { id: string; method: string; isCurrent: boolean; startedAt: string; params: Record<string, unknown> };
  grade: number;
  /** Grades 3–4: band midpoint shift per wave, children present in both runs. */
  waves: { ordinal: number; children: number; meanShift: number | null; movedTenOrMore: number; bandsA: number; bandsB: number }[];
  /** Grades 0–2: how many skill states differ. */
  skills: { ordinal: number; states: number; changed: number }[];
  /** The 15 items whose difficulty moved most. */
  items: { code: string; isAnchor: boolean; bA: number | null; bB: number | null }[];
  inflation: { runId: string; regionId: number; regionUz: string; regionRu: string; delta: number; n: number }[];
}

// ============================================================ outcomes (outcome.import)

/**
 * POST /api/staff/outcomes/import { fileName, csv } (≤ 50 000 rows, ≤ 25 MB) → ImportResult.
 *   Columns (header row, comma or semicolon): pinfl, family_name, given_name, school (optional), admitted (yes/no/ha/yo'q/1/0), year.
 *   400 CSV_EMPTY | CSV_COLUMNS {missing} | CSV_TOO_LARGE {max}.
 *   The PINFL is matched by hash inside the service and NEVER returned or stored.
 */
export interface ImportResult {
  importId: string;
  rows: number;
  matched: number;
  unmatched: number;
  /** Line numbers (1 = header) with PINFL_INVALID | ADMITTED_INVALID | YEAR_INVALID | DUPLICATE_CHILD_YEAR. */
  invalid: { line: number; reason: string }[];
}

/** GET /api/staff/outcomes?year= */
export interface OutcomesSummary {
  imports: { id: string; fileName: string; admitYear: number; importedAt: string; importedBy: string; rows: number; matched: number; unmatched: number; invalid: number }[];
  totals: { rows: number; matched: number; pending: number; notZinapo: number; admitted: number };
  /** The validation question: admission rate by the child's last band (top10 · top25 · top50 · rest · none). */
  byBand: { bucket: 'top10' | 'top25' | 'top50' | 'rest' | 'none'; children: number; admitted: number; rate: number | null }[];
}

/** GET /api/staff/outcomes/pending?year= — names and the date of birth from the official list; never a PINFL. */
export interface PendingOutcome {
  id: string;
  admitYear: number;
  admitted: boolean;
  familyName: string;
  givenName: string;
  dob: string;
  school: string | null;
  line: number;
  importedAt: string;
}

/**
 * GET /api/staff/outcomes/:id/candidates → OutcomeCandidate[] (same date of birth, similar family name, masked).
 * POST /api/staff/outcomes/:id/match { childId } → { ok }   409 DOB_MISMATCH | ALREADY_REVIEWED | CHILD_ALREADY_HAS_OUTCOME
 * POST /api/staff/outcomes/:id/not-zinapo → { ok }          409 ALREADY_REVIEWED
 */
export interface OutcomeCandidate {
  childId: string;
  /** "KARIMOVA M***A" */
  name: string;
  dob: string;
  grade: number | null;
  regionUz: string | null;
  regionRu: string | null;
  sameFamilyName: boolean;
}

// ============================================================ support (person.lookup)

type InviteState = 'waiting' | 'accepted' | 'cancelled' | 'expired';

/**
 * GET /api/staff/people?phone= → PersonLookup (400 PHONE_INVALID | PHONE_REQUIRED).
 * POST /api/staff/people/invites/:id/resend { kind: 'guardian'|'educator' } (invite.resend) → { resent } (false = already today)
 *   409 INVITE_NOT_LIVE
 * POST /api/staff/people/login-requests/:id/cancel { phone } (login.reset) → { ok }; 404 if not that phone's request.
 */
export interface PersonLookup {
  found: boolean;
  phone: string;
  invitesForThisPhone: {
    guardian: { id: string; kind: 'co_guardian' | 'ownership_transfer'; child: string; from: string; expiresAt: string; state: InviteState }[];
    educator: { id: string; educator: string; sentAt: string; expiresAt: string; state: InviteState }[];
  };
  login: {
    requests: { id: string; status: string; createdAt: string; expiresAt: string; codesIssued: number; attempts: number; telegramLinked: boolean }[];
    /** Seconds the "too many sign-in starts" limit still holds for this phone. */
    startLimitedForSec: number;
  };
  person?: { id: string; name: string; locale: string; createdAt: string; verifiedVia: string | null; phoneVerifiedAt: string | null; telegramLinked: boolean };
  workspaces?: { family: boolean; educator: string | null; staff: string[] };
  guardianships?: { child: string; grade: number | null; role: 'owner' | 'co_guardian'; since: string; revokedAt: string | null }[];
  educator?: { status: string; kind: string; publicCode: string; activeLinks: number } | null;
  invitesSent?: { id: string; kind: string; to: string; child: string; expiresAt: string; state: InviteState }[];
  sessions?: { active: number; lastUsedAt: string | null };
}

// ============================================================ super admin

/**
 * GET /api/staff/roles (role.manage) → StaffRoles
 * POST /api/staff/roles { phone, role } → StaffRoles (201)   404 PERSON_NOT_FOUND · 409 ALREADY_HAS_ROLE · 400 PHONE_INVALID
 * DELETE /api/staff/roles/:assignmentId → StaffRoles          409 LAST_SUPER_ADMIN
 */
export interface StaffRoles {
  roles: string[];
  people: { personId: string; name: string; phone: string | null; roles: { assignmentId: string; role: string; grantedAt: string; grantedBy: string | null }[] }[];
}

/**
 * GET /api/staff/audit?action=&phone=&from=&to=&before=&limit= (audit.read) — newest first; `action` matches
 * exactly or as a group prefix ("staff_role" → staff_role.*); `before` = the previous page's `nextBefore`.
 * GET /api/staff/audit/actions → { action, n }[] for the filter.
 */
export interface AuditPage {
  entries: {
    id: number;
    at: string;
    action: string;
    person: { name: string; phone: string | null } | null;
    /** Scrubbed when written: secrets show as "[redacted]". Render as text, never as HTML. */
    payload: unknown;
    ip: string | null;
    userAgent: string | null;
  }[];
  nextBefore: number | null;
}
