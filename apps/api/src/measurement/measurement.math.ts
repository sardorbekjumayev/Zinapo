/**
 * The arithmetic of `raw_band_v0` (task.md § 9), as pure functions so they
 * can be unit-tested without a database (`scripts/measurement-unit.mjs`).
 *
 * Nothing here is ever shown to a parent as a number: these feed the derived
 * tables, and the report turns them into ranges and words (§ 1.9, § 1.10).
 */

export const COHORT_MINIMUM = 30;

/** Population variance. */
export function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
}

/**
 * KR-20 reliability of a test of k dichotomous items.
 * `matrix[person][item]` is 1 for correct, 0 otherwise.
 * Returns null when it cannot be estimated (fewer than 2 people or items, or no
 * variance in total scores).
 */
export function kr20(matrix: number[][]): number | null {
  const n = matrix.length;
  const k = n ? matrix[0].length : 0;
  if (n < 2 || k < 2) return null;
  const totals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const vt = variance(totals);
  if (vt === 0) return null;
  let pq = 0;
  for (let j = 0; j < k; j++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += matrix[i][j];
    const p = c / n;
    pq += p * (1 - p);
  }
  return (k / (k - 1)) * (1 - pq / vt);
}

/**
 * The standard error of measurement of a raw score: SD × √(1 − r). When the
 * reliability cannot be estimated (a small or uniform cohort), fall back to the
 * binomial error of a k-item test at the mean proportion, √(k·p̄·(1−p̄)), which
 * is conservative — it widens the band rather than pretending precision.
 * Never below 1 raw point: one 30-question test always carries some error
 * (design/03: "a range, not a single number").
 */
export function sem(totals: number[], k: number, reliability: number | null): number {
  const sd = Math.sqrt(variance(totals));
  let e: number;
  if (reliability !== null && reliability > 0 && reliability < 1 && sd > 0) {
    e = sd * Math.sqrt(1 - reliability);
  } else {
    const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const p = k > 0 ? Math.min(Math.max(mean / k, 0), 1) : 0.5;
    e = Math.sqrt(k * p * (1 - p));
  }
  return Math.max(1, e);
}

/**
 * Mid-rank percentile of `x` within `scores`: the share below plus half the
 * share equal, in percent (1–100).
 */
export function percentileRank(x: number, scores: number[]): number {
  if (scores.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const s of scores) {
    if (s < x) below += 1;
    else if (s === x) equal += 1;
  }
  const pr = (100 * (below + equal / 2)) / scores.length;
  return Math.min(100, Math.max(1, Math.round(pr)));
}

/**
 * § 9 v0: "the percentile of score ± SEM, stored as pct_low/pct_high". Below
 * the cohort minimum there is no band (INV-11, the schema enforces it too).
 */
export function band(
  score: number,
  cohort: number[],
  semValue: number,
): { low: number | null; high: number | null } {
  if (cohort.length < COHORT_MINIMUM) return { low: null, high: null };
  const low = percentileRank(score - semValue, cohort);
  const high = percentileRank(score + semValue, cohort);
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

/** Pearson correlation of a 0/1 item with the rest score (total minus the item). */
export function pointBiserial(item: number[], totals: number[]): number | null {
  const n = item.length;
  if (n < 3) return null;
  const rest = totals.map((t, i) => t - item[i]);
  const mi = item.reduce((a, b) => a + b, 0) / n;
  const mr = rest.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vi = 0;
  let vr = 0;
  for (let i = 0; i < n; i++) {
    cov += (item[i] - mi) * (rest[i] - mr);
    vi += (item[i] - mi) ** 2;
    vr += (rest[i] - mr) ** 2;
  }
  if (vi === 0 || vr === 0) return null;
  return cov / Math.sqrt(vi * vr);
}

/** A v0 difficulty on a logit scale from p: b = ln((1 − p) / p), bounded. */
export function logitDifficulty(p: number): number {
  const q = Math.min(Math.max(p, 0.01), 0.99);
  return Math.log((1 - q) / q);
}

/**
 * DIF uz vs ru, v0: the difference in logit difficulty between the two
 * language groups. Null unless both groups have at least `minN` answers.
 */
export function difUzRu(uz: number[], ru: number[], minN = 20): number | null {
  if (uz.length < minN || ru.length < minN) return null;
  const p = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return logitDifficulty(p(uz)) - logitDifficulty(p(ru));
}

export type SkillStateValue = 'not_yet' | 'emerging' | 'secure';

/**
 * § 9 v0, grades 0–2: "≥ 2 correct items on a skill in a wave → candidate;
 * confirmed in a later wave → secure; partial → emerging" (note M5-b).
 *
 *   secure   — ≥ 2 correct now and ≥ 2 correct in an earlier wave (confirmed),
 *              or already secure and still answering correctly
 *   emerging — some correct (a first-time candidate is emerging until confirmed)
 *   not_yet  — none correct
 */
export function skillState(
  correctNow: number,
  history: { correct: number; state: SkillStateValue }[],
): SkillStateValue {
  const wasCandidate = history.some((h) => h.correct >= 2);
  const wasSecure = history.some((h) => h.state === 'secure');
  if (correctNow >= 2 && wasCandidate) return 'secure';
  if (wasSecure && correctNow >= 1) return 'secure';
  if (correctNow >= 1) return 'emerging';
  return 'not_yet';
}

export type ClusterStanding = 'strength' | 'in_line' | 'weaker';

/**
 * design/03 "A strength / In line / Most points lost": a cluster compared with
 * the child's OWN overall result, not with other children — so it means the
 * same thing in a cohort of 12 or 1,200 (note M5-c). ±15 percentage points.
 */
export function clusterStanding(clusterShare: number, overallShare: number): ClusterStanding {
  const d = clusterShare - overallShare;
  if (d >= 0.15) return 'strength';
  if (d <= -0.15) return 'weaker';
  return 'in_line';
}
