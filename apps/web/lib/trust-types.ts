/**
 * M8 — trust & safety API contracts (task.md § 8.5, apps/api/src/trust/*).
 * Dates are ISO strings.
 *
 * Decided with the product owner (task.md notes M8-a … M8-d): the four rules'
 * thresholds; "confirm and escalate" suspends an educator; a won dispute is a
 * clean handover; dispute evidence is written statements + staff call notes
 * (no document is ever uploaded).
 */

export type CaseKind = 'fraud_flag' | 'ownership_dispute' | 'fifth_child' | 'educator_application';
export type CaseStatus = 'open' | 'waiting_owner' | 'resolved' | 'dismissed';
/**
 *   many_owners_one_device — ≥ 3 people add a child from one device (IP + browser) within 2 h
 *   surname_mismatch_group — one owner, ≥ 3 children with different surnames, in one educator group
 *   owner_never_opens_reports — ≥ 3 waves taken this season, no guardian ever opened a report
 *   match_check_bursts — an educator: ≥ 10 match-checks in an hour or ≥ 15 misses in 24 h
 *   olympiad_fast_answers — (M7) an online stage answered implausibly fast and right
 */
export type RuleCode =
  | 'many_owners_one_device'
  | 'surname_mismatch_group'
  | 'owner_never_opens_reports'
  | 'match_check_bursts'
  | 'olympiad_fast_answers';

/** GET /api/staff/cases?kind=&bucket=open|waiting|closed&mine=1 (case.read — trust_safety) */
export interface CaseList {
  /** Open and waiting counts per kind, for the tabs. */
  counts: Partial<Record<CaseKind, { open: number; waiting: number }>>;
  cases: {
    id: string;
    /** "R-1A2B3C4D" (R fraud, D dispute, F fifth child, E application). */
    reference: string;
    kind: CaseKind;
    status: CaseStatus;
    openedAt: string;
    resolvedAt: string | null;
    resolution: string | null;
    assignee: { personId: string; name: string; me: boolean } | null;
    subjectName: string | null;
    childName: string | null;
    rule: RuleCode | null;
    /** 1–3, higher first. */
    severity: number | null;
  }[];
}

/** GET /api/staff/cases/staff — who a case can be assigned to. */
export interface CaseStaff {
  personId: string;
  name: string;
}

export interface CaseNote {
  id: number;
  authorRole: 'claimant' | 'owner' | 'staff';
  authorName: string;
  body: string;
  createdAt: string;
}

/** A person as staff see them: name and a MASKED phone, never a PINFL. */
export interface CasePerson {
  personId: string;
  name: string;
  phone: string | null;
}

/** GET /api/staff/cases/:id — one of `fraud` / `dispute` / `fifthChild` / `application` is set. */
export interface CaseDetail {
  id: string;
  reference: string;
  kind: CaseKind;
  status: CaseStatus;
  openedAt: string;
  resolvedAt: string | null;
  /** fraud: false_positive · confirmed · confirmed_educator_suspended · owners_answered;
   *  dispute: kept · transferred; fifth child: approved · rejected; application: approved · rejected */
  resolution: string | null;
  assignee: { personId: string; name: string; me: boolean } | null;
  notes: CaseNote[];
  fraud?: {
    rule: RuleCode | null;
    severity: number | null;
    raisedAt: string | null;
    flagResolution: string | null;
    /** Rule-specific: counts, windows, ids (resolved to names below). Never a PINFL. */
    evidence: Record<string, unknown>;
    evidencePeople: { id: string; name: string }[];
    evidenceChildren: { id: string; name: string }[];
    subject: CasePerson | null;
    child: { id: string; name: string; dob: string; grade: number | null } | null;
    educator: { personId: string; name: string; status: string; publicCode: string; activeLinks: number } | null;
    /** Links this case suspended, with each owner's answer. */
    suspendedLinks: { id: string; childName: string; status: string; ownerResponse: 'kept' | 'revoked' | null; ownerRespondedAt: string | null; suspendedAt: string | null }[];
    canSuspendLinks: boolean;
  };
  dispute?: {
    child: { id: string; name: string; dob: string; grade: number | null } | null;
    claimant: (CasePerson & { claimedName: string }) | null;
    owner: CasePerson | null;
    claimantConfirmed: boolean;
  };
  fifthChild?: {
    parent: CasePerson | null;
    requested: { name: string; grade: number | null };
    alreadyOwns: number;
    children: { name: string; grade: number | null; dob: string; since: string }[];
    /** The approval was used to add the child. */
    used: boolean;
  };
  /** Decide with M6's POST /api/staff/educator-applications/:personId/decision. */
  application?: {
    personId: string;
    name: string;
    kind: string;
    status: string;
    regionUz: string | null;
    regionRu: string | null;
    schoolName: string | null;
    subjects: string[] | null;
    appliedAt: string;
  } | null;
}

/*
 * Actions (case.resolve; suspend-links and confirm also need link.suspend) → CaseDetail:
 *   POST /api/staff/cases/:id/assign { personId | null }            400 NOT_TRUST_SAFETY
 *   POST /api/staff/cases/:id/notes { body }                        (staff note, 201)
 *   fraud_flag:
 *     POST …/suspend-links { note? }  open → waiting_owner; 409 CASE_NOT_OPEN | NO_EDUCATOR
 *     POST …/dismiss { note (3+) }    → dismissed; 409 CASE_CLOSED
 *     POST …/confirm { note (3+) }    → resolved; educator suspended if there is one; 409 CASE_CLOSED
 *     POST …/close { note? }          waiting_owner → resolved (owners answered); 409 CASE_NOT_WAITING
 *   fifth_child:  POST …/fifth-child { decision: 'approved'|'rejected', note? }   409 CASE_CLOSED
 *   ownership_dispute: POST …/dispute { decision: 'keep'|'transfer', note (3+) }
 *     409 CASE_CLOSED | CLAIM_NOT_CONFIRMED | ALREADY_OWNER
 */

// ============================================================== family side

/** GET /api/family/disputes — as claimant or as the (current or former) owner of the claimed child. */
export interface FamilyDispute {
  id: string;
  reference: string;
  role: 'claimant' | 'owner';
  /** The claimant sees the name THEY typed; the owner sees their child's name. */
  childName: string;
  /** Only while this person holds the child (the claimant after a transfer, the owner otherwise). */
  childId: string | null;
  status: CaseStatus;
  /** kept | transferred | null */
  outcome: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

/**
 * GET /api/family/disputes/:id — only the party's OWN statements; never the
 * other side's identity or words. 404 for anyone else.
 * POST /api/family/disputes/:id/statements { body (1–4000) } → this, 201.
 *   409 CASE_CLOSED | TOO_MANY_STATEMENTS (10)
 */
export interface FamilyDisputeDetail extends FamilyDispute {
  statements: { id: number; body: string; createdAt: string }[];
  canWrite: boolean;
}

/**
 * The family access page (GET /api/family/children/:id/educators — M2) now
 * carries, per link, `awaitingOwnerAnswer` and `suspendedReason`
 * (lib/family-types.ts EducatorAccess). The owner answers with
 * POST /api/family/children/:id/educators/:linkId/answer { keep } → { ok, status: 'active'|'revoked' }
 * (owner only; 404 once answered).
 */
