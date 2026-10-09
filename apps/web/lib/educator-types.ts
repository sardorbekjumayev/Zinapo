/**
 * M6 — the educator workspace's API contracts (task.md § 6.1 "Educator",
 * apps/api/src/educator/*). Dates are ISO strings.
 *
 * Decided with the product owner (task.md note M6-a): the educator never sees
 * a percentile — progress arrives as a CATEGORY (`GainCategory`), the number
 * behind the sort stays on the server.
 */

// ------------------------------------------------------------ application

export type EducatorKind = 'tutor' | 'school_teacher' | 'learning_centre';
export type EducatorStatus = 'applied' | 'approved' | 'rejected' | 'suspended';
export type Subject = 'numeracy' | 'reasoning' | 'language';

/** GET /api/educator/profile — `{ status: null }` for someone who never applied. */
export interface EducatorProfile {
  status: EducatorStatus | null;
  kind?: EducatorKind;
  /** Only once approved, e.g. "AZR-4821". */
  publicCode?: string | null;
  region?: { id: number; nameUz: string; nameRu: string } | null;
  school?: { id: string; name: string } | null;
  subjects?: Subject[];
  appliedAt?: string;
  decidedAt?: string | null;
  /** A rejection's reason, for the applicant. */
  note?: string | null;
}

/** POST /api/educator/apply → EducatorProfile. 409 ALREADY_APPLIED | SCHOOL_NOT_IN_REGION. */
export interface ApplyInput {
  kind: EducatorKind;
  regionId: number;
  schoolId?: string | null;
  /** 1–3. */
  subjects: Subject[];
}

// ------------------------------------------------------------ invites

/** POST /api/educator/invites { phones: string[] } (≤ 200 lines; blank lines ignored). */
export interface InviteSendResult {
  sent: number;
  /** A live invite to that number already exists — not sent again. */
  alreadyInvited: number;
  duplicates: number;
  /** 1-based line numbers of numbers that are not a valid UZ number. */
  invalid: { line: number; value: string }[];
  expiresInDays: number;
}

export type InviteState = 'joined' | 'waiting' | 'expired';

/** GET /api/educator/invites */
export interface InviteList {
  counts: { sent: number; joined: number; waiting: number; expired: number };
  /** POST /api/educator/invites/remind → { reminded } sends to `eligible` (each invite at most every 3 days). */
  remind: { eligible: number; nextAt: string | null; everyDays: number };
  invites: {
    id: string;
    /** The full number — the educator typed it. */
    phone: string;
    state: InviteState;
    /** "joined and shared": the parent's child is now visible to this educator. */
    shared: boolean;
    sentAt: string;
    expiresAt: string;
    joinedAt: string | null;
    remindedAt: string | null;
  }[];
}
// POST /api/educator/invites/:id/resend — an EXPIRED invite: new code, new 14 days → { ok }.

/** GET /api/educator/match-check/limits (also inside every match-check reply). */
export interface MatchLimits {
  used: number;
  /** 25 */
  limit: number;
  missesInRow: number;
  /** 3 */
  missesBeforePause: number;
  /** Set while checks are paused (3 misses in a row → 1 hour). */
  pausedUntil: string | null;
  /** The next Tashkent midnight. */
  resetsAt: string;
}

/**
 * POST /api/educator/match-check { pinfl (14 digits), familyName }.
 * 400 PINFL_INVALID; 429 MATCH_CHECK_PAUSED { until } | MATCH_CHECK_LIMIT { resetsAt }.
 */
export type MatchResult =
  | { match: false; limits: MatchLimits }
  | {
      match: true;
      /** "KARIMOVA M***A" */
      maskedName: string;
      /** Single use, 15 minutes: POST /api/educator/access-requests { matchToken }. */
      matchToken: string;
      /** The educator's own latest link to this child, if any. */
      existingLink: 'requested' | 'active' | 'declined' | 'revoked' | 'suspended' | 'expired' | null;
      limits: MatchLimits;
    };

/** POST /api/educator/access-requests → 201. 409 LINK_EXISTS { status } | DECLINED_THIS_SEASON; 404 MATCH_TOKEN_INVALID. */
export interface AccessRequestResult {
  linkId: string;
  status: 'requested';
  expiresAt: string;
}

/** GET /api/public/educator-invites/:code — no session needed; 404 for a dead code. */
export interface PublicInvite {
  educatorName: string;
  publicCode: string;
  expiresAt: string;
}

// ------------------------------------------------------------ groups

/** GET /api/educator/groups */
export interface GroupList {
  groups: { id: string; name: string; grade: number | null; note: string | null; createdAt: string; memberCount: number }[];
  /** Visible children in no group. */
  ungroupedCount: number;
}
// POST /api/educator/groups { name, grade?, note? } → { id, created } (same name → that group, created:false)
// PATCH /api/educator/groups/:id { name?, grade?, note?, archived? } → { ok }
// POST /api/educator/groups/:id/members { childIds } → { added, skipped } (only visible children of the group's grade)
// DELETE /api/educator/groups/:id/members/:childId → { ok }

/** GET /api/educator/children — every child the educator can see (the "add to group" picker). */
export interface VisibleChild {
  id: string;
  name: string;
  givenName: string;
  grade: number | null;
  accessUntil: string;
  isOwnChild: boolean;
  groups: { id: string; name: string }[];
}

/** GET /api/educator/my-children — the educator's OWN kids (guardianship); they open /family/children/[id]. */
export interface MyChild {
  id: string;
  name: string;
  givenName: string;
  grade: number | null;
  role: 'owner' | 'co_guardian';
}

/**
 * Progress between the two latest measured waves:
 *   up        — moved up (grades 3–4: +3 percentile points or more; 0–2: more skills secure)
 *   flat      — no real change (inside the measurement error)
 *   look      — worth a look (grades 3–4: −5 or lower; 0–2: fewer skills secure)
 *   first     — measured, but nothing to compare with yet (first wave, or no band: cohort < 30)
 *   not_taken — not measured at the latest wave
 */
export type GainCategory = 'up' | 'flat' | 'look' | 'first' | 'not_taken';

export type WaveState = 'open' | 'closed' | 'upcoming';

export interface Misconception {
  code: string;
  nameUz: string;
  nameRu: string;
  explainUz: string;
  explainRu: string;
  topic: { code: string; nameUz: string; nameRu: string };
  cluster: 'numeracy' | 'reasoning' | 'language';
  /** How many CHILDREN picked a distractor with this code — "12 of 14 children". */
  childCount: number;
  /** Those children — "assign to the 12 who made this mistake". */
  childIds: string[];
}

/** GET /api/educator/groups/:id/overview?waveId= (design/08). */
export interface GroupOverview {
  group: { id: string; name: string; grade: number | null };
  waves: { id: string; ordinal: number; opensAt: string; closesAt: string; state: WaveState }[];
  /** Selected: `waveId`, else the open wave, else the latest. Decides taken / not taken and the mistakes. */
  wave: { id: string; ordinal: number; state: WaveState; opensAt: string; closesAt: string } | null;
  /** Progress compares measured wave `from` → `to` (an open wave is measured only after it closes). */
  progressWaves: { from: number | null; to: number | null };
  stats: { total: number; took: number; up: number; flat: number; look: number };
  /** ALREADY SORTED by gain (best first) — never re-sort by anything else (§ 8.4.4). Own child excluded. */
  children: {
    id: string;
    name: string;
    givenName: string;
    progress: GainCategory;
    tookSelectedWave: boolean;
    accessUntil: string;
  }[];
  /** Top 4 for the selected wave. */
  misconceptions: Misconception[];
  notTaken: { id: string; name: string; givenName: string; inProgress: boolean; remindedToday: boolean }[];
  /** Reminders only while the selected wave is open. */
  canRemind: boolean;
  /** The educator's own child is in this group and was left out (show the note). */
  ownChildExcluded: boolean;
}

/**
 * POST /api/educator/groups/:id/reminders { childIds? } — `wave_reminder` to the
 * OWNER of each child who has not taken the open wave (all if no ids). One per
 * child per day from anyone: `alreadyToday` counts the ones skipped.
 * 409 NO_OPEN_WAVE.
 */
export interface RemindResult {
  reminded: number;
  alreadyToday: number;
}

/** GET /api/educator/children/:id (design/08's pupil panel; 404 without an ACTIVE link). */
export interface Pupil {
  child: { id: string; name: string; givenName: string; grade: number | null };
  isOwnChild: boolean;
  /** Own child only: the full parent report is at /[locale]/family/children/[id]. */
  parentReportAvailable: boolean;
  accessUntil: string;
  groups: { id: string; name: string }[];
  waves: { id: string; ordinal: number; state: WaveState; closesAt: string; taken: boolean; progress: GainCategory | null }[];
  latestProgress: { waveOrdinal: number; category: GainCategory } | null;
  dominantMisconception: {
    code: string;
    nameUz: string;
    nameRu: string;
    explainUz: string;
    explainRu: string;
    waveOrdinal: number;
  } | null;
  practice: { assigned: number; done: number };
}

// ------------------------------------------------------------ practice

/** GET /api/educator/practice/topics?grade=N */
export interface PracticeTopic {
  code: string;
  nameUz: string;
  nameRu: string;
  cluster: 'numeracy' | 'reasoning' | 'language';
  /** Approved non-anchor items — 0 means "nothing to build from". */
  items: number;
}

/**
 * POST /api/educator/practice/forms { source: 'misconception'|'topic', code, grade, size? (3–20, default 10) }
 *   → PracticeForm. 409 NO_ITEMS; 404 SOURCE_NOT_FOUND.
 * GET  /api/educator/practice/forms/:id → PracticeForm
 * POST /api/educator/practice/forms/:id/swap { position } → PracticeForm. 409 NO_ALTERNATIVE | FORM_FROZEN.
 */
export interface PracticeForm {
  id: string;
  grade: number;
  label: string;
  /** Assigned once → frozen; swap is no longer possible. */
  frozen: boolean;
  source: { kind: 'misconception' | 'topic'; code: string; nameUz: string; nameRu: string } | null;
  /** Scored items — what "solved X of N" counts. */
  size: number;
  items: {
    position: number;
    itemVersionId: string;
    /** false = a pretest item riding along unscored. */
    scored: boolean;
    /** The item carries exactly the source mistake (vs. filled in from its topic). */
    fromMistake: boolean;
    stemFormat: string;
    stemUz: string;
    stemRu: string;
    hasImage: boolean;
    topic: { nameUz: string; nameRu: string };
    cluster: string;
    difficulty: 'easy' | 'medium' | 'hard';
  }[];
}

/** POST /api/educator/practice/assignments { formId, childIds, groupId? } (also …/:id/repeat { childIds }). */
export interface AssignResult {
  id: string;
  assigned: number;
  /** Ids the educator cannot see (no active link) — dropped. */
  skipped: number;
  /** DELETE /api/educator/practice/assignments/:id until then, while nobody started. 409 UNDO_EXPIRED | ALREADY_STARTED. */
  undoUntil: string;
}

/** GET /api/educator/practice/assignments/:id/results ("how many solved" — nothing else). */
export interface AssignmentResults {
  id: string;
  /** Uzbek; `labelRu` for ru. */
  label: string;
  labelRu: string;
  source: { kind: 'misconception' | 'topic'; code: string } | null;
  formId: string;
  groupId: string | null;
  groupName: string | null;
  repeatOf: string | null;
  createdAt: string;
  undoUntil: string;
  /** Scored items in the set. */
  total: number;
  summary: {
    assigned: number;
    completed: number;
    notStarted: number;
    /** Median solved among those who finished; null before anyone has. */
    typicalSolved: number | null;
    /** Finished with fewer than `struggledBelow` solved. */
    struggledCount: number;
    struggledIds: string[];
    struggledBelow: number;
  };
  children: {
    id: string;
    name: string;
    givenName: string;
    status: 'done' | 'started' | 'not_started';
    /** Only when done. */
    solved: number | null;
  }[];
}

/** GET /api/educator/practice/assignments?groupId= — newest first, the same without `children`. */
export type AssignmentSummary = Omit<AssignmentResults, 'children'>;

// ------------------------------------------------------------ family side

/**
 * GET /api/family/children/:id/practice — the parent sees WHAT and WHETHER,
 * never how many solved ("the parent sees the practice count only").
 * POST /api/family/children/:id/practice/:assignmentId/sessions → { sessionId, resumed } → /[locale]/play/[sessionId].
 * 409 PRACTICE_DONE | CONSENT_REQUIRED.
 */
export interface FamilyPractice {
  assignmentId: string;
  /** Uzbek; `titleRu` for ru. */
  title: string;
  titleRu: string;
  educatorName: string;
  assignedAt: string;
  items: number;
  status: 'done' | 'started' | 'not_started';
  sessionId: string | null;
  doneAt: string | null;
}

// ------------------------------------------------------------ staff

/** GET /api/staff/educator-applications?status=applied|decided (permission educator.decide — trust_safety). */
export interface EducatorApplication {
  personId: string;
  fullName: string;
  phone: string;
  kind: EducatorKind;
  status: EducatorStatus;
  regionUz: string | null;
  regionRu: string | null;
  schoolName: string | null;
  subjects: Subject[] | null;
  appliedAt: string;
  decidedAt: string | null;
  note: string | null;
  decidedBy: string | null;
  caseId: string | null;
}
// POST /api/staff/educator-applications/:personId/decision { decision: 'approved'|'rejected', note? } → { personId, status }. 409 ALREADY_DECIDED.

/** GET /api/staff/educator-preapprovals */
export interface Preapproval {
  id: string;
  phone: string;
  kind: EducatorKind;
  note: string | null;
  createdAt: string;
  invitedBy: string;
  usedAt: string | null;
  usedBy: string | null;
  cancelledAt: string | null;
}
// POST /api/staff/educator-preapprovals { phone, kind?, note? } → { phone, approvedNow } (approvedNow: that person had applied and is approved at once).
//   409 PHONE_INVALID | ALREADY_PREAPPROVED | ALREADY_EDUCATOR.
// DELETE /api/staff/educator-preapprovals/:id → { ok } (unused ones only).
