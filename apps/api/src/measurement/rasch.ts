/**
 * `rasch_anchor_equating_v1` — the dichotomous Rasch model, estimated by joint
 * maximum likelihood (JMLE), in plain TypeScript (decided with the product
 * owner, task.md note M9-a). Pure functions: no database, unit-tested by
 * scripts/measurement-unit.sh.
 *
 *   P(correct | θ, b) = 1 / (1 + e^-(θ - b))
 *
 * Anchor equating: items whose difficulty is FIXED (an anchor calibrated in an
 * earlier current run) are never moved — they pin this run's scale to the
 * earlier one, horizontally across waves and vertically across grades. With
 * nothing fixed, the free items' mean difficulty is set to 0 (the scale's
 * origin for a first run).
 *
 * Extreme scores (all wrong / all right) have no finite JML estimate; they are
 * nudged by 0.3 of a point (the common Winsteps-style adjustment) so every
 * child gets a theta and an SE.
 */

export interface RaschInput {
  /** persons × items; 1 correct, 0 wrong, null not presented / skipped-unseen. */
  responses: (0 | 1 | null)[][];
  /** Item index → fixed difficulty (anchors). */
  fixed?: Map<number, number>;
  maxIter?: number;
  tolerance?: number;
}

export interface RaschResult {
  theta: number[];
  thetaSe: number[];
  b: number[];
  bSe: (number | null)[];
  /** Item infit mean-square (≈ 1 is a good fit); null for an item nobody saw. */
  infit: (number | null)[];
  iterations: number;
  converged: boolean;
}

const EXTREME = 0.3;
const LIMIT = 6;

export const prob = (theta: number, b: number): number => 1 / (1 + Math.exp(-(theta - b)));

/** θ for one person with difficulties known (scoring a final against the calibrated scale). */
export function estimateTheta(answers: (0 | 1 | null)[], b: number[], maxIter = 50): { theta: number; se: number } | null {
  const seen = answers.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
  if (!seen.length) return null;
  const k = seen.length;
  let r = seen.reduce((a, i) => a + (answers[i] as number), 0);
  r = Math.min(Math.max(r, EXTREME), k - EXTREME);
  let theta = Math.log(r / (k - r)) + seen.reduce((a, i) => a + b[i], 0) / k;
  let info = 0;
  for (let it = 0; it < maxIter; it++) {
    let expected = 0;
    info = 0;
    for (const i of seen) {
      const p = prob(theta, b[i]);
      expected += p;
      info += p * (1 - p);
    }
    const step = (r - expected) / Math.max(info, 1e-9);
    theta = Math.min(Math.max(theta + Math.max(-1, Math.min(1, step)), -LIMIT), LIMIT);
    if (Math.abs(step) < 1e-4) break;
  }
  return { theta, se: 1 / Math.sqrt(Math.max(info, 1e-9)) };
}

export function rasch(input: RaschInput): RaschResult {
  const X = input.responses;
  const nP = X.length;
  const nI = nP ? X[0].length : 0;
  const fixed = input.fixed ?? new Map<number, number>();
  const maxIter = input.maxIter ?? 200;
  const tol = input.tolerance ?? 1e-4;

  // Raw scores over presented items, with the extreme-score nudge.
  const personSeen = X.map((row) => row.filter((x) => x !== null).length);
  const personScore = X.map((row, n) => {
    const s = row.reduce<number>((a, x) => a + (x ?? 0), 0);
    return personSeen[n] ? Math.min(Math.max(s, EXTREME), personSeen[n] - EXTREME) : 0;
  });
  const itemSeen = Array.from({ length: nI }, (_, i) => X.reduce((a, row) => a + (row[i] === null ? 0 : 1), 0));
  const itemScore = Array.from({ length: nI }, (_, i) => {
    const s = X.reduce<number>((a, row) => a + (row[i] ?? 0), 0);
    return itemSeen[i] ? Math.min(Math.max(s, EXTREME), itemSeen[i] - EXTREME) : 0;
  });

  // Starting values: log-odds.
  const b = Array.from({ length: nI }, (_, i) =>
    fixed.has(i) ? fixed.get(i)! : itemSeen[i] ? Math.log((itemSeen[i] - itemScore[i]) / itemScore[i]) : 0,
  );
  const theta = X.map((_, n) => (personSeen[n] ? Math.log(personScore[n] / (personSeen[n] - personScore[n])) : 0));

  let iterations = 0;
  let converged = false;
  for (; iterations < maxIter; iterations++) {
    let maxChange = 0;
    // Persons.
    for (let n = 0; n < nP; n++) {
      if (!personSeen[n]) continue;
      let expected = 0;
      let info = 0;
      for (let i = 0; i < nI; i++) {
        if (X[n][i] === null) continue;
        const p = prob(theta[n], b[i]);
        expected += p;
        info += p * (1 - p);
      }
      const step = Math.max(-1, Math.min(1, (personScore[n] - expected) / Math.max(info, 1e-9)));
      theta[n] = Math.min(Math.max(theta[n] + step, -LIMIT), LIMIT);
      maxChange = Math.max(maxChange, Math.abs(step));
    }
    // Free items.
    for (let i = 0; i < nI; i++) {
      if (fixed.has(i) || !itemSeen[i]) continue;
      let expected = 0;
      let info = 0;
      for (let n = 0; n < nP; n++) {
        if (X[n][i] === null) continue;
        const p = prob(theta[n], b[i]);
        expected += p;
        info += p * (1 - p);
      }
      const step = Math.max(-1, Math.min(1, (itemScore[i] - expected) / Math.max(info, 1e-9)));
      b[i] = Math.min(Math.max(b[i] - step, -LIMIT), LIMIT);
      maxChange = Math.max(maxChange, Math.abs(step));
    }
    // Identification without anchors: free items centred on 0.
    if (fixed.size === 0) {
      const free = b.filter((_, i) => itemSeen[i]);
      const mean = free.reduce((a, x) => a + x, 0) / Math.max(free.length, 1);
      for (let i = 0; i < nI; i++) if (itemSeen[i]) b[i] -= mean;
      for (let n = 0; n < nP; n++) theta[n] -= mean;
    }
    if (maxChange < tol) {
      converged = true;
      break;
    }
  }

  const thetaSe = X.map((row, n) => {
    let info = 0;
    for (let i = 0; i < nI; i++) if (row[i] !== null) info += prob(theta[n], b[i]) * (1 - prob(theta[n], b[i]));
    return 1 / Math.sqrt(Math.max(info, 1e-9));
  });
  const bSe = b.map((bi, i) => {
    if (!itemSeen[i]) return null;
    let info = 0;
    for (let n = 0; n < nP; n++) if (X[n][i] !== null) info += prob(theta[n], bi) * (1 - prob(theta[n], bi));
    return 1 / Math.sqrt(Math.max(info, 1e-9));
  });
  const infit = b.map((bi, i) => {
    if (!itemSeen[i]) return null;
    let num = 0;
    let den = 0;
    for (let n = 0; n < nP; n++) {
      const x = X[n][i];
      if (x === null) continue;
      const p = prob(theta[n], bi);
      num += (x - p) ** 2;
      den += p * (1 - p);
    }
    return den > 0 ? num / den : null;
  });

  return { theta, thetaSe, b, bSe, infit, iterations: iterations + 1, converged };
}

/**
 * The inflation adjustment of one cohort (§ 9): the mean of (monitoring θ −
 * final θ) over children who sat both. Only applied with at least `minN`
 * pairs (M9-c); the final corrects monitoring, never the reverse.
 */
export function inflationDelta(pairs: { monitoring: number; final: number }[], minN = 30): number | null {
  if (pairs.length < minN) return null;
  return pairs.reduce((a, p) => a + (p.monitoring - p.final), 0) / pairs.length;
}
