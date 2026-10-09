/**
 * M7 — olympiad API contracts (task.md § 6.1, apps/api/src/olympiad/*).
 * Dates are ISO strings.
 *
 * Decided with the product owner (task.md notes M7-a … M7-d): a browser
 * offline runner; the teacher bonus = certificates at the final × rate; the
 * season cup = ½ final percentile + ½ gain from autumn; without a ticket the
 * spring online top 30 % qualify for the final.
 */

export type StageKind = 'autumn_online' | 'mini_final' | 'spring_online' | 'spring_final';
export type StageState = 'upcoming' | 'open' | 'closed';

// ============================================================== family

/**
 * Why a stage can (not) be registered for:
 *   ok · registered · grade (outside the olympiad's grades) · closed (registration over)
 *   needs_ticket_or_qualification (final: < 3 waves and not in the spring online top 30 %)
 *   needs_invitation (mini-final: not in the autumn top N) · no_form (online stage not ready)
 */
export type Eligibility =
  | 'ok'
  | 'registered'
  | 'grade'
  | 'closed'
  | 'needs_ticket_or_qualification'
  | 'needs_invitation'
  | 'no_form';

export interface VenueOption {
  id: string;
  name: string;
  address: string;
  startsAt: string;
  capacity: number;
  seatsLeft: number;
}

export type ClusterStanding = 'strength' | 'in_line' | 'weaker';

export interface FamilyEntry {
  id: string;
  /** open · ticket (≥ 3 waves) · qualified (spring online top 30 %) · invited (mini-final) */
  entryVia: 'open' | 'ticket' | 'qualified' | 'invited' | null;
  registeredAt: string;
  venue: { id: string; name: string; address: string; startsAt: string } | null;
  checkedIn: boolean;
  /** Online stages: POST …/entries/:id/sessions → /play/[sessionId]. */
  session: { id: string; status: 'started' | 'submitted' | 'expired' | 'voided' } | null;
  /** Only once the operator published the stage AND the child sat it. */
  result: {
    /** Ranked olympiads only, cohort ≥ 30: "top {from}–{to}%" — a range, never a point. */
    band: { top: { from: number; to: number } } | null;
    cohortN: number | null;
    /** Top `certificateTopPct` of region × grade. */
    certificate: boolean;
    /** autumn online → invited to the mini-final; spring online → qualified for the final. */
    qualified: boolean;
    diagnostic:
      | {
          kind: 'clusters';
          /** Relative to the child's own overall result on this sitting. */
          clusters: Partial<Record<'numeracy' | 'reasoning' | 'language', ClusterStanding>>;
          mistake: { code: string; nameUz: string; nameRu: string; explainUz: string; explainRu: string } | null;
        }
      | {
          kind: 'skills';
          /** Grades 0–2: one sitting — "strong here" (≥ 2 correct), emerging, not yet. */
          skills: { code: string; nameUz: string; nameRu: string; state: 'strong' | 'emerging' | 'not_yet' }[];
        }
      | null;
  } | null;
  resultsPublished: boolean;
  childId: string;
}

export interface FamilyStage {
  id: string;
  kind: StageKind;
  inPerson: boolean;
  opensAt: string;
  closesAt: string;
  registrationClosesAt: string;
  state: StageState;
  eligibility: Eligibility;
  /** In-person stages the child may enter (or is entered in): venues in the child's region. */
  venues: VenueOption[];
  entry: FamilyEntry | null;
}

/** GET /api/family/children/:id/olympiad (any live guardian). */
export interface FamilyOlympiadView {
  child: { id: string; givenName: string; grade: number; regionUz: string; regionRu: string };
  /** design/07 "Who comes with Madina": the profile owner. */
  owner: { name: string };
  /** "≥ 3 monitoring waves = direct entry to the spring final". */
  ticket: { waves: number; needed: number; earned: boolean; taken: { ordinal: number; submittedAt: string }[] };
  olympiads: {
    id: string;
    slug: string;
    titleUz: string;
    titleRu: string;
    /** false = grades 0–2 marathon: no places, no ranking. */
    isRanked: boolean;
    certificateTopPct: number;
    stages: FamilyStage[];
    /** Published only: certificate · place (1–3, at the final) · season_cup (place 1–3). */
    awards: { kind: 'certificate' | 'place' | 'season_cup'; place: number | null; stageId: string | null }[];
  }[];
}

/**
 * POST /api/family/children/:id/olympiad/:olympiadId/register { stageId?, venueId?, source? }
 *   — OWNER only (co-guardian → 404). Again = change venue. → 201 { entryId, stageId, entryVia }
 *   400 VENUE_REQUIRED · 404 STAGE_NOT_FOUND | VENUE_NOT_FOUND · 409 NOT_ELIGIBLE {reason: Eligibility}
 *   | VENUE_FULL | VENUE_OTHER_REGION | VENUE_PROCTORED_BY_GUARDIAN | ALREADY_CHECKED_IN (checked in or a session exists)
 * DELETE /api/family/children/:id/olympiad/entries/:entryId — owner; 409 ALREADY_TAKEN | STAGE_CLOSED
 * POST /api/family/children/:id/olympiad/entries/:entryId/sessions → { sessionId, resumed }
 *   409 IN_PERSON_STAGE | STAGE_NOT_OPEN | STAGE_NOT_READY | ENTRY_TAKEN | CONSENT_REQUIRED
 */
export interface RegisterResult {
  entryId: string;
  stageId: string;
  entryVia: 'open' | 'ticket' | 'qualified' | 'invited';
}

/** GET /api/public/olympiads/:slug — no session; 404 for an unknown slug. */
export interface PublicOlympiad {
  slug: string;
  titleUz: string;
  titleRu: string;
  gradeMin: number;
  gradeMax: number;
  isRanked: boolean;
  stages: { kind: StageKind; inPerson: boolean; opensAt: string; closesAt: string; registrationClosesAt: string; state: StageState }[];
}

// ============================================================== operator

/** GET /api/staff/olympiads (olympiad.manage) */
export interface OlympiadSummary {
  id: string;
  slug: string;
  titleUz: string;
  titleRu: string;
  gradeMin: number;
  gradeMax: number;
  isRanked: boolean;
  seasonCode: string;
  entries: number;
  stages: { kind: StageKind; opensAt: string; closesAt: string; published: boolean }[] | null;
}

/**
 * POST /api/staff/olympiads { slug, titleUz, titleRu, gradeMin, gradeMax, certificateTopPct?, qualifyTopPct?,
 *   miniFinalTopN?, bonusRate?, cupTopN? } → OlympiadDetail. 409 SLUG_TAKEN | NO_CURRENT_SEASON.
 * PATCH /api/staff/olympiads/:id (same fields, all optional; grades only before any entry — 409 HAS_ENTRIES)
 * PUT /api/staff/olympiads/:id/stages/:kind { opensAt, closesAt, registrationClosesAt? } → OlympiadDetail
 * PUT /api/staff/olympiads/:id/stages/:stageId/forms/:grade { formId } → OlympiadDetail
 *   409 FORM_MISMATCH | FORM_NOT_FROZEN | STAGE_STARTED; 400 GRADE_OUT_OF_RANGE
 * GET /api/staff/olympiads/forms?grade=N → OlympiadForm[] (frozen olympiad-mode forms)
 */
export interface OlympiadDetail {
  id: string;
  slug: string;
  titleUz: string;
  titleRu: string;
  gradeMin: number;
  gradeMax: number;
  isRanked: boolean;
  certificateTopPct: number;
  qualifyTopPct: number;
  miniFinalTopN: number;
  bonusRate: number;
  cupTopN: number;
  seasonCode: string;
  stages: {
    id: string;
    kind: StageKind;
    opensAt: string;
    closesAt: string;
    registrationClosesAt: string | null;
    state: StageState;
    inPerson: boolean;
    forms: { grade: number; formId: string; label: string }[];
    entries: number;
    submitted: number;
    resultsComputedAt: string | null;
    resultsPublishedAt: string | null;
  }[];
  venues: StaffVenue[];
}

export interface OlympiadForm {
  id: string;
  grade: number;
  label: string;
  frozenAt: string;
  items: number;
}

/**
 * POST /api/staff/olympiads/:id/venues { stageId, regionId?, name, address, capacity, startsAt } → StaffVenue[]
 *   409 STAGE_IS_ONLINE
 * PATCH /api/staff/olympiads/:id/venues/:venueId { name?, address?, capacity?, startsAt?, regionId? } → StaffVenue[]
 *   409 BELOW_SEATED {seated}
 * POST /api/staff/olympiads/:id/venues/:venueId/proctors { phone } → StaffVenue[]; 404 NOT_A_PROCTOR; 409 OWN_CHILD_AT_VENUE
 * DELETE /api/staff/olympiads/:id/venues/:venueId/proctors/:personId → StaffVenue[]
 * POST /api/staff/olympiads/:id/venues/:venueId/notify → { sent, already } ("final_venue_details", once per entry)
 */
export interface StaffVenue {
  id: string;
  stageId: string;
  stageKind: StageKind;
  regionId: number | null;
  regionUz: string | null;
  regionRu: string | null;
  name: string;
  address: string;
  capacity: number;
  startsAt: string;
  seated: number;
  checkedIn: number;
  proctors: { personId: string; name: string }[] | null;
}

/** GET /api/staff/olympiads/:id/stages/:stageId/entries — the operator's table (names, never PINFL). */
export interface StaffEntry {
  id: string;
  name: string;
  grade: number;
  regionId: number;
  regionUz: string;
  regionRu: string;
  entryVia: string | null;
  source: string | null;
  registeredAt: string;
  venue: string | null;
  checkedInAt: string | null;
  adultMatchesOwner: boolean | null;
  sessionStatus: string | null;
  score: number | null;
  rank: number | null;
  percentile: number | null;
  certificate: boolean;
  qualified: boolean;
  flaggedAt: string | null;
}

/**
 * POST /api/staff/olympiads/:id/stages/:stageId/results (olympiad.results) → ComputeSummary; 409 RESULTS_PUBLISHED
 * POST /api/staff/olympiads/:id/stages/:stageId/publish → { published, notified }; 409 RESULTS_PUBLISHED | RESULTS_NOT_COMPUTED
 */
export interface ComputeSummary {
  taken: number;
  certificates: number;
  qualified: number;
  flagged: number;
  bonusEducators: number;
  cups: number;
}

/** GET /api/staff/olympiads/:id/awards */
export interface StaffAward {
  id: string;
  kind: 'place' | 'certificate' | 'season_cup' | 'teacher_bonus';
  stageKind: StageKind | null;
  place: number | null;
  amount: number | null;
  note: string | null;
  regionId: number | null;
  regionUz: string | null;
  regionRu: string | null;
  grade: number | null;
  childName: string | null;
  educatorName: string | null;
  issuedAt: string;
}

// ============================================================== proctor

/** GET /api/staff/finals (final.proctor) — only venues this proctor is assigned to. */
export interface ProctorVenue {
  id: string;
  name: string;
  address: string;
  startsAt: string;
  capacity: number;
  olympiadUz: string;
  olympiadRu: string;
  stageKind: StageKind | null;
  regionUz: string | null;
  regionRu: string | null;
  seated: number;
  checkedIn: number;
  submitted: number;
}

/**
 * GET /api/staff/finals/:venueId → Roster (404 for a venue that is not yours)
 * POST /api/staff/finals/:venueId/check-in { entryId, adultMatchesOwner } → { ok } (again = correct it)
 * DELETE /api/staff/finals/:venueId/check-in/:entryId → { ok }; 409 ALREADY_STARTED
 */
export interface Roster {
  venue: { id: string; name: string; address: string; startsAt: string; capacity: number; olympiadUz: string; olympiadRu: string; stageKind: StageKind | null };
  children: {
    entryId: string;
    name: string;
    grade: number;
    /** The adult expected at the door: the profile owner. */
    ownerName: string | null;
    checkedInAt: string | null;
    adultMatchesOwner: boolean | null;
    sessionId: string | null;
    sessionStatus: 'started' | 'submitted' | 'expired' | null;
    syncSource: 'online' | 'offline_sync' | null;
    formReady: boolean;
  }[];
}

/**
 * GET /api/staff/finals/:venueId/package — the offline runner's package. One
 * session per CHECKED-IN child (same ids on a re-download), each form once
 * with media inline as data: URIs. No answer keys. 409 STAGE_NOT_READY {grades}.
 */
export interface FinalPackage {
  venue: Roster['venue'];
  generatedAt: string;
  sessions: { sessionId: string; status: 'started' | 'submitted'; entryId: string; childName: string; grade: number; formId: string }[];
  forms: Record<string, PackageForm>;
}

export interface PackageForm {
  formId: string;
  grade: number;
  timeLimitSec: number | null;
  /** Same shape as kid mode's bundle items (lib/session-types.ts BundleItem), media as data: URIs. */
  items: {
    position: number;
    itemVersionId: string;
    stemFormat: string;
    stemUz: string;
    stemRu: string;
    imageUrl: string | null;
    audioUrlUz: string | null;
    audioUrlRu: string | null;
    options: { id: string; position: number; labelUz: string; labelRu: string; imageUrl: string | null }[];
  }[];
}

/**
 * POST /api/staff/finals/:venueId/sync { sessions: SyncSession[] } (≤ 1000) → SyncResult.
 * Idempotent: an already-submitted session counts as `already`. Unanswered
 * items may be left out (they become skips).
 */
export interface SyncSession {
  sessionId: string;
  startedAt: string;
  submittedAt: string;
  device?: string;
  answers: {
    itemVersionId: string;
    chosenOptionId: string | null;
    clientRecordedAt: string;
    responseMs?: number | null;
    revisionCount?: number;
    flagged?: boolean;
  }[];
}

export interface SyncResult {
  synced: number;
  already: number;
  rejected: { sessionId: string; reason: string }[];
}
