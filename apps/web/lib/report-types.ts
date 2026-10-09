/**
 * The parent report read model, mirrored from
 * apps/api/src/measurement/reporting.service.ts (task.md § 8.1.3, M5).
 * Two templates: grades 3–4 (a percentile band, as a range) and grades 0–2
 * (skill states only — no rank, no forecast, INV-11).
 */

export interface ReportBase {
  child: { givenName: string; familyName: string; grade: number };
  season: string | null;
  runAt: string | null;
  /** The next wave to take (open now, or upcoming), if any. */
  next: { ordinal: number; opensAt: string; closesAt: string; open: boolean } | null;
  access: {
    guardians: { name: string; role: 'owner' | 'co_guardian' }[];
    educators: { name: string; validUntil: string }[];
  };
  /** § 1.11: practice shows "how many", never a result. */
  practiceCount: number;
  /** design/03: 3 monitoring waves taken = direct entry to the spring final. */
  ticket: { taken: number; needed: number };
}

/** "Top X–Y%" — the band read from the strong end. Never a single number. */
export interface TopRange {
  from: number;
  to: number;
}

export type TrendState = 'measured' | 'awaiting' | 'not_taken' | 'open' | 'upcoming';

export interface TrendPoint {
  waveId: string;
  ordinal: number;
  opensAt: string;
  state: TrendState;
  /** null: not measured, below the cohort minimum, or not visible to this reader. */
  top: TopRange | null;
  belowMinimum: boolean;
  cohortN: number | null;
}

export type ClusterStanding = 'strength' | 'in_line' | 'weaker';

export interface MisconceptionInfo {
  code: string;
  nameUz: string;
  nameRu: string;
  explainUz: string;
  explainRu: string;
}

export interface Report34 extends ReportBase {
  template: 'grade_3_4';
  empty: boolean;
  trend: TrendPoint[];
  canSeePercentile?: boolean;
  latest?: {
    waveId: string;
    ordinal: number;
    top: TopRange | null;
    cohortN: number;
    cohortMinimum: number;
    belowMinimum: boolean;
    regionUz: string;
    regionRu: string;
  };
  /** { numeracy: 'strength' | 'in_line' | 'weaker', … } — words, never numbers. */
  clusters?: Partial<Record<'numeracy' | 'reasoning' | 'language', ClusterStanding>>;
  pattern?: MisconceptionInfo | null;
  seasonPattern?: (MisconceptionInfo & { waves: number; of: number }) | null;
}

export interface SkillHistory {
  waveOrdinal: number;
  opensAt: string | null;
  state: 'secure' | 'emerging' | 'not_yet';
  correct: number;
  seen: number;
}

export interface SkillRow {
  code: string;
  nameUz: string;
  nameRu: string;
  topicCode: string;
  cluster: 'numeracy' | 'reasoning' | 'language';
  /** null = not assessed yet this season. */
  state: 'secure' | 'emerging' | 'not_yet' | null;
  history: SkillHistory[];
  securedAtWave: number | null;
}

export interface Report02 extends ReportBase {
  template: 'grade_0_2';
  empty: boolean;
  skillsTotal: number;
  counts?: { secure: number; emerging: number; notYet: number; unassessed: number };
  skills?: SkillRow[];
  newlySecure?: { code: string; nameUz: string; nameRu: string; waveOrdinal: number }[];
  focus?: { code: string; nameUz: string; nameRu: string; cluster: string } | null;
  /** Always null — design/04 "What we don't do": no forecast at this age. */
  forecast?: null;
}

export type Report = Report34 | Report02;

export interface CalibrationRun {
  id: string;
  method: 'raw_band_v0' | 'rasch_anchor_equating_v1';
  grade: number;
  waveId: string | null;
  waveOrdinal: number | null;
  startedAt: string;
  finishedAt: string | null;
  isCurrent: boolean;
  params: { sem?: string; cohort?: string; minimum?: number; waves?: Record<string, { sessions: number; reliability: number | null; sem: number }> };
  triggeredBy: string | null;
  seasonCode: string;
  sessions: number;
  bands: number;
  belowMinimum: number;
  skillStates: number;
  itemStatistics: number;
}
