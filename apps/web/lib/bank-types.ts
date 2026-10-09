/**
 * The item bank & forms API shapes, mirrored from apps/api/src/bank (task.md
 * § 6.1 Staff). One file so an API change has one place to land.
 */

export type Cluster = 'numeracy' | 'reasoning' | 'language';
export type ItemStatus = 'draft' | 'in_review' | 'accepted' | 'approved' | 'rejected' | 'retired';
export type StemFormat = 'text' | 'image' | 'image_audio';
export type AnchorKind = 'horizontal' | 'vertical';
export type SlotRole = 'scored' | 'anchor' | 'pretest';
export type FormMode = 'monitoring' | 'practice' | 'olympiad';

export interface Topic {
  code: string;
  cluster: Cluster;
  gradeMin: number;
  gradeMax: number;
  nameUz: string;
  nameRu: string;
  sort: number;
  itemCount: number;
}

export interface Skill {
  code: string;
  topicCode: string;
  grade: number;
  nameUz: string;
  nameRu: string;
  itemCount: number;
}

export interface Misconception {
  code: string;
  topicCode: string;
  nameUz: string;
  nameRu: string;
  explainUz: string;
  explainRu: string;
  retiredAt: string | null;
  optionCount: number;
}

export interface Taxonomy {
  topics: Topic[];
  skills: Skill[];
  misconceptions: Misconception[];
}

export interface MediaRef {
  ref: string;
  /** Short-lived signed URL, same origin (`/api/media/...`). */
  url: string;
}

export interface ItemListRow {
  id: string;
  code: string;
  grade: number;
  cluster: Cluster;
  topicCode: string;
  status: ItemStatus;
  isAnchor: boolean;
  anchorKind: AnchorKind | null;
  anchorLinkGrade: number | null;
  authorName: string;
  isMine: boolean;
  version: number;
  frozen: boolean;
  stemUz: string;
  stemRu: string;
  langs: ('uz' | 'ru')[];
  /** p_out · low_r · dead_distractor · dif — empty until calibration (M5/M9). */
  flags: string[];
  stats: { n: number; p: number | null; pointBiserial: number | null } | null;
}

export interface BankTile {
  grade: number;
  target: number | null;
  approved: number;
  accepted: number;
  inReview: number;
  draft: number;
}

export interface BankOverview {
  season: { id: string; code: string } | null;
  tiles: BankTile[];
  totals: { written: number; approved: number; decided: number; rejected: number };
}

export interface ItemList {
  items: ItemListRow[];
  total: number;
  page: number;
  perPage: number;
  /** null for an author, who sees only their own items. */
  overview: BankOverview | null;
}

export interface ItemOption {
  position: number;
  labelUz: string;
  labelRu: string;
  image: MediaRef | null;
  /** Absent when the key is hidden from this reader (a reviewer before the blind solve). */
  isKey?: boolean;
  misconceptionCode?: string | null;
  rationale?: string | null;
}

export interface ItemReviewNote {
  id: string;
  reviewerName: string;
  verdict: 'accept' | 'revise' | 'reject' | 'auto_reject';
  note: string | null;
  blindWasCorrect: boolean | null;
  decidedAt: string;
}

export interface ItemVersion {
  id: string;
  version: number;
  frozenAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  createdByName: string;
  stemFormat: StemFormat;
  stemUz: string;
  stemRu: string;
  expectedP: number | null;
  image: MediaRef | null;
  audioUz: MediaRef | null;
  audioRu: MediaRef | null;
  options: ItemOption[];
  keysHidden: boolean;
  reviews: ItemReviewNote[];
  stats: {
    n: number;
    p: string | null;
    pointBiserial: string | null;
    difUzRu: string | null;
    difficultyB: string | null;
    distractorShare: Record<string, number>;
    method: string;
    runAt: string;
  } | null;
}

export interface ItemCard {
  id: string;
  code: string;
  grade: number;
  topicCode: string;
  topicNameUz?: string;
  topicNameRu?: string;
  cluster?: Cluster;
  skillCode: string | null;
  construct: string;
  status: ItemStatus;
  isAnchor: boolean;
  anchorKind: AnchorKind | null;
  anchorLinkGrade: number | null;
  acceptedAt: string | null;
  retiredAt: string | null;
  authorName: string;
  isMine: boolean;
  authorAcceptedThisSeason: number;
  /** Newest first. versions[0] is the one being edited or reviewed. */
  versions: ItemVersion[];
  usedIn: { id: string; label: string; mode: FormMode; grade: number; frozenAt: string | null; slotRole: SlotRole }[];
  can: {
    edit: boolean;
    editItemFields: boolean;
    submit: boolean;
    newVersion: boolean;
    approve: boolean;
    retire: boolean;
    setAnchor: boolean;
  };
}

/** What `PUT /staff/items/:id/draft` accepts; send only what changed. */
export interface DraftPatch {
  grade?: number;
  topicCode?: string;
  skillCode?: string | null;
  construct?: string;
  stemFormat?: StemFormat;
  stemUz?: string;
  stemRu?: string;
  imageRef?: string | null;
  audioRefUz?: string | null;
  audioRefRu?: string | null;
  expectedP?: number | null;
  options?: {
    labelUz: string;
    labelRu: string;
    imageRef?: string | null;
    isKey: boolean;
    misconceptionCode?: string | null;
    rationale?: string | null;
  }[];
}

export interface ReviewQueueRow {
  versionId: string;
  itemId: string;
  code: string;
  grade: number;
  cluster: Cluster;
  topicCode: string;
  authorName: string;
  version: number;
  submittedAt: string;
  solvedByMe: boolean | null;
}

export interface ReviewQueue {
  items: ReviewQueueRow[];
  mine: { accept: number; revise: number; reject: number };
}

export interface ReviewOption {
  id: string;
  position: number;
  labelUz: string;
  labelRu: string;
  image: MediaRef | null;
  isKey?: boolean;
  misconceptionCode?: string | null;
  misconceptionNameUz?: string | null;
  misconceptionNameRu?: string | null;
  rationale?: string | null;
}

export interface ReviewView {
  versionId: string;
  itemId: string;
  code: string;
  grade: number;
  cluster: Cluster;
  topicCode: string;
  construct: string;
  authorName: string;
  version: number;
  expectedP: number | null;
  stemFormat: StemFormat;
  stemUz: string;
  stemRu: string;
  image: MediaRef | null;
  audioUz: MediaRef | null;
  audioRu: MediaRef | null;
  options: ReviewOption[];
  step: 'solve' | 'verdict' | 'done';
  myAnswer: string | null;
  agreed: boolean | null;
  verdict: 'accept' | 'revise' | 'reject' | 'auto_reject' | null;
  note: string | null;
  decidedByOther: boolean;
}

export interface PlanSlot {
  position: number;
  role: SlotRole;
}

export interface FormSlot {
  position: number;
  slotRole: SlotRole;
  isScored: boolean;
  itemVersionId: string;
  version: number;
  itemId: string;
  code: string;
  cluster: Cluster;
  topicCode: string;
  isAnchor: boolean;
  anchorKind: AnchorKind | null;
  status: ItemStatus;
  retired: boolean;
  expectedP: number | null;
  difficultyB: number | null;
  stemUz: string;
  bilingual: boolean;
  usedInWaves: number[] | null;
}

export type RuleId =
  | 'filled'
  | 'slots_valid'
  | 'anchors_spread'
  | 'anchors_middle'
  | 'pretest_unscored'
  | 'cluster_coverage'
  | 'no_anchor_in_practice'
  | 'bilingual';

export interface RuleResult {
  id: RuleId;
  applicable: boolean;
  ok: boolean;
  details: Record<string, unknown>;
}

export interface FormView {
  id: string;
  mode: FormMode;
  grade: number;
  label: string;
  timeLimitSec: number | null;
  createdAt: string;
  createdByName: string | null;
  frozenAt: string | null;
  frozenByName: string | null;
  copiedFrom: string | null;
  plan: PlanSlot[];
  slots: FormSlot[];
  rules: RuleResult[];
  canFreeze: boolean;
}

export interface FormListRow {
  id: string;
  mode: FormMode;
  grade: number;
  label: string;
  frozenAt: string | null;
  createdAt: string;
  seasonCode: string | null;
  planned: number;
  filled: number;
  waveOrdinal: number | null;
}

export interface Candidate {
  itemVersionId: string;
  itemId: string;
  code: string;
  grade: number;
  cluster: Cluster;
  topicCode: string;
  isAnchor: boolean;
  anchorKind: AnchorKind | null;
  anchorLinkGrade: number | null;
  status: ItemStatus;
  version: number;
  expectedP: number | null;
  difficultyB: number | null;
  stemUz: string;
}
