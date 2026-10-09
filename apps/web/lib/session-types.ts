/**
 * Sessions & kid mode API shapes, mirrored from apps/api/src/sessions and
 * apps/api/src/seasons (task.md § 6.1, M4).
 */

export type SessionMode = 'monitoring' | 'practice' | 'olympiad';
export type SessionStatus = 'started' | 'submitted' | 'expired' | 'voided';

export interface BundleOption {
  id: string;
  position: number;
  labelUz: string;
  labelRu: string;
  imageUrl: string | null;
}

/** One question as kid mode gets it — never a key, a role or an expected p. */
export interface BundleItem {
  position: number;
  itemVersionId: string;
  stemFormat: 'text' | 'image' | 'image_audio';
  stemUz: string;
  stemRu: string;
  imageUrl: string | null;
  audioUrlUz: string | null;
  audioUrlRu: string | null;
  options: BundleOption[];
}

export interface SavedAnswer {
  itemVersionId: string;
  chosenOptionId: string | null;
  flagged: boolean;
  revisionCount: number;
  responseMs: number | null;
  clientRecordedAt: string;
}

export interface Bundle {
  sessionId: string;
  mode: SessionMode;
  status: SessionStatus;
  childName: string;
  grade: number;
  waveOrdinal: number | null;
  waveClosesAt: string | null;
  timeLimitSec: number | null;
  startedAt: string;
  deadlineAt: string | null;
  serverTime: string;
  items: BundleItem[];
  /** What this or another device already synced — resume from here. */
  answers: SavedAnswer[];
}

/** What the device sends; `clientRecordedAt` decides which version of an answer wins. */
export interface AnswerInput {
  itemVersionId: string;
  chosenOptionId: string | null;
  flagged?: boolean;
  revisionCount?: number;
  responseMs?: number;
  clientRecordedAt: string;
}

export interface SessionResult {
  sessionId: string;
  mode: SessionMode;
  status: SessionStatus;
  submittedAt: string | null;
  /** Practice only — "how many solved", never a percentile (§ 1.11). */
  solved?: number;
  total?: number;
}

export type WaveState = 'upcoming' | 'open' | 'in_progress' | 'taken' | 'missed';

export interface ChildWave {
  id: string;
  ordinal: number;
  grade: number;
  opensAt: string;
  closesAt: string;
  ready: boolean;
  timeLimitSec: number | null;
  questions: number;
  sessionId: string | null;
  sessionStatus: SessionStatus | null;
  submittedAt: string | null;
  deadlineAt: string | null;
  state: WaveState;
}

export interface ChildWaves {
  grade: number | null;
  /** Live data-processing consent — without it no wave can start (note M2-e). */
  consent: boolean;
  waves: ChildWave[];
}

export interface Season {
  id: string;
  code: string;
  nameUz: string;
  nameRu: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface StaffWave {
  id: string;
  grade: number;
  ordinal: number;
  opensAt: string;
  closesAt: string;
  closedAt: string | null;
  formId: string | null;
  formLabel: string | null;
  state: 'upcoming' | 'open' | 'closed';
  submitted: number;
  inProgress: number;
  eligible: number;
}

export interface WaveForm {
  id: string;
  label: string;
  frozenAt: string;
  positions: number;
  usedByWaves: number[] | null;
}

export interface StaffSchool {
  id: string;
  regionId: number;
  kind: 'general' | 'presidential' | 'specialised' | 'private' | 'other';
  name: string;
  district: string | null;
  pupils: number;
}
