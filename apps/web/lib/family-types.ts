/**
 * The family API's shapes, mirrored from apps/api/src/identity (task.md § 6.1).
 * Kept in one file so a server change has exactly one place to land here.
 */

export type GuardianRole = 'owner' | 'co_guardian';
export type ConsentType = 'data_processing' | 'third_party_transfer' | 'marketing';

export interface ChildSummary {
  id: string;
  familyName: string;
  givenName: string;
  patronymic: string | null;
  dob: string;
  via: GuardianRole;
  grade: number | null;
  schoolYear: number | null;
  schoolRegionId: number | null;
  regionNameUz: string | null;
  regionNameRu: string | null;
  schoolId: string | null;
  schoolName: string | null;
  ownerName: string | null;
  deletionRequested: boolean;
}

export interface Enrolment {
  id: string;
  schoolYear: number;
  grade: number;
  schoolRegionId: number;
  regionNameUz: string;
  regionNameRu: string;
  schoolName: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface Region {
  id: number;
  nameUz: string;
  nameRu: string;
}

export interface School {
  id: string;
  name: string;
  district: string | null;
  kind: string;
}

export interface ConsentState {
  type: ConsentType;
  required: boolean;
  given: boolean;
  documentVersion: string | null;
  givenAt: string | null;
  revokedAt: string | null;
  currentDocumentVersion: string;
}

export interface ChildConsents {
  childId: string;
  childName: string;
  canManage: boolean;
  consents: ConsentState[];
}

export interface GuardianView {
  personId: string;
  fullName: string;
  role: GuardianRole;
  isMe: boolean;
  since: string;
}

export interface PendingInvite {
  id: string;
  kind: 'co_guardian' | 'ownership_transfer';
  phone: string;
  inviteeName: string | null;
  expiresAt: string;
  sentAt: string;
}

export interface IncomingInvite {
  code: string;
  kind: 'co_guardian' | 'ownership_transfer';
  childName: string;
  childGrade: number | null;
  inviterName: string;
  expiresAt: string;
}

export type LinkStatus = 'requested' | 'active' | 'declined' | 'revoked' | 'suspended' | 'expired';

export interface EducatorAccess {
  linkId: string;
  educatorName: string;
  educatorKind: 'tutor' | 'school_teacher' | 'learning_centre';
  publicCode: string;
  status: LinkStatus;
  requestedAt: string;
  requestExpiresAt: string | null;
  validUntil: string;
  decidedAt: string | null;
  revokedAt: string | null;
  canRestore: boolean;
  /** M8: trust & safety suspended this link and asks the owner to keep or end it. */
  awaitingOwnerAnswer?: boolean;
  suspendedReason?: string | null;
}

export interface UntilOptions {
  schoolYearEnd: string;
  threeMonths: string;
  max: string;
}

export type ChangeAction =
  | 'child.created'
  | 'child.updated'
  | 'child.enrolment_added'
  | 'guardian.invited'
  | 'guardian.invite_accepted'
  | 'guardian.invite_cancelled'
  | 'guardian.removed'
  | 'ownership.transfer_offered'
  | 'ownership.transfer_cancelled'
  | 'ownership.transferred'
  | 'consent.given'
  | 'consent.revoked'
  | 'access.requested'
  | 'access.granted'
  | 'access.declined'
  | 'access.revoked'
  | 'access.restored'
  | 'access.suspended'
  | 'privacy.anonymisation_requested'
  | 'privacy.anonymisation_cancelled';

export interface ChangeLogEntry {
  id: string;
  action: ChangeAction;
  at: string;
  by: { name: string | null; isMe: boolean };
  subject: string | null;
  details: {
    type?: ConsentType;
    documentVersion?: string;
    validUntil?: string;
    grade?: number;
    via?: string;
  };
}

export interface ChangeLogPage {
  entries: ChangeLogEntry[];
  total: number;
  nextCursor: string | null;
}

export interface AnonymisationRequest {
  id: string;
  reference: string;
  requestedAt: string;
  executeAfter: string;
}

export interface InvitePreview {
  educatorName: string;
  publicCode: string;
  validUntil: string;
}

export interface CreateChildInput {
  pinfl: string;
  familyName: string;
  givenName: string;
  patronymic?: string;
  dob: string;
  grade: number;
  schoolRegionId: number;
  schoolId?: string;
  consents: { type: ConsentType; given: boolean }[];
  inviteCode?: string;
  shareWithInviter?: boolean;
}

export interface CreateChildResult {
  id: string;
  alreadyYours?: boolean;
  sharedWith?: { educatorName: string; validUntil: string } | null;
}
