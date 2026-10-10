#!/usr/bin/env node
/**
 * Unit tests for the `raw_band_v0` arithmetic (task.md § 9, § 11: "unit tests
 * for … measurement"). Pure functions, no database:
 *
 *   ./scripts/measurement-unit.sh
 *
 * Runs against the API's compiled output (`apps/api/dist`, written by
 * `npm run build` or the dev server's watcher).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const path = new URL('../apps/api/dist/measurement/measurement.math.js', import.meta.url).pathname;
if (!existsSync(path)) {
  console.error('apps/api/dist is missing — run `cd apps/api && npm run build` (or start the dev server) first');
  process.exit(1);
}
const m = require(path);

test('KR-20: a perfectly consistent test is reliable, noise is not', () => {
  // Guttman pattern: each person gets the easiest k items right.
  const guttman = [0, 1, 2, 3, 4, 5].map((s) => [0, 1, 2, 3, 4].map((j) => (j < s ? 1 : 0)));
  assert.ok(m.kr20(guttman) > 0.8, `got ${m.kr20(guttman)}`);
  const same = [[1, 0, 1], [1, 0, 1], [1, 0, 1]];
  assert.equal(m.kr20(same), null, 'no variance in totals → not estimable');
  assert.equal(m.kr20([[1, 0]]), null, 'one person → not estimable');
});

test('SEM: SD·√(1−r), binomial fallback, never below one raw point', () => {
  const totals = [10, 12, 14, 16, 18, 20];
  const sd = Math.sqrt(m.variance(totals));
  assert.ok(Math.abs(m.sem(totals, 25, 0.75) - sd * 0.5) < 1e-9);
  assert.ok(m.sem(totals, 25, null) > 1, 'fallback is used without a reliability');
  assert.equal(m.sem([5, 5, 5], 25, 0.99), 2, 'no variance → binomial fallback, √(25·0.2·0.8)');
  assert.equal(m.sem([5, 5, 6], 25, 0.9), 1, 'a tiny SEM is floored at one raw point');
});

test('percentile rank: mid-rank, clamped to 1–100', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(m.percentileRank(5, s), 45); // 4 below + half of 1 equal → 45%
  assert.equal(m.percentileRank(0, s), 1); // nobody below → clamped to 1, never 0
  assert.equal(m.percentileRank(100, s), 100);
});

test('band: a range, and nothing below the cohort minimum (INV-11)', () => {
  const cohort = Array.from({ length: 40 }, (_, i) => i % 26);
  const b = m.band(15, cohort, 2);
  assert.ok(b.low !== null && b.high !== null && b.low < b.high, JSON.stringify(b));
  assert.deepEqual(m.band(15, cohort.slice(0, 29), 2), { low: null, high: null });
  assert.equal(m.COHORT_MINIMUM, 30);
});

test('point-biserial: a discriminating item correlates with the rest score', () => {
  const totals = [2, 4, 6, 8, 10, 12];
  assert.ok(m.pointBiserial([0, 0, 0, 1, 1, 1], totals) > 0.5);
  assert.ok(m.pointBiserial([1, 1, 1, 0, 0, 0], totals) < -0.5);
  assert.equal(m.pointBiserial([1, 1, 1, 1, 1, 1], totals), null, 'no variance → null');
});

test('DIF uz/ru needs both groups, and is zero when they behave alike', () => {
  const g = (n, p) => Array.from({ length: n }, (_, i) => (i < n * p ? 1 : 0));
  assert.equal(m.difUzRu(g(10, 0.5), g(30, 0.5)), null);
  assert.ok(Math.abs(m.difUzRu(g(40, 0.5), g(40, 0.5))) < 1e-9);
  assert.ok(m.difUzRu(g(40, 0.3), g(40, 0.7)) > 1, 'harder in uz → positive');
});

test('skill states (§ 9): candidate → emerging, confirmed → secure', () => {
  assert.equal(m.skillState(0, []), 'not_yet');
  assert.equal(m.skillState(1, []), 'emerging');
  assert.equal(m.skillState(2, []), 'emerging', 'a first ≥2 is only a candidate');
  assert.equal(m.skillState(2, [{ correct: 2, state: 'emerging' }]), 'secure', 'confirmed in a later wave');
  assert.equal(m.skillState(1, [{ correct: 1, state: 'emerging' }]), 'emerging');
  assert.equal(m.skillState(1, [{ correct: 2, state: 'emerging' }, { correct: 3, state: 'secure' }]), 'secure');
  assert.equal(m.skillState(0, [{ correct: 3, state: 'secure' }]), 'not_yet', 'secure is not forever');
});

test('cluster standing is relative to the child, ±15 points', () => {
  assert.equal(m.clusterStanding(0.8, 0.6), 'strength');
  assert.equal(m.clusterStanding(0.6, 0.6), 'in_line');
  assert.equal(m.clusterStanding(0.4, 0.6), 'weaker');
});

// ------------------------------------------------------------- M9: Rasch v1

const raschPath = new URL('../apps/api/dist/measurement/rasch.js', import.meta.url).pathname;
const R = existsSync(raschPath) ? require(raschPath) : null;

/** Deterministic simulated data: P = logistic(θ − b). */
function simulate(thetas, bs, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) % 100000) / 100000;
  return thetas.map((t) => bs.map((b) => (rnd() < 1 / (1 + Math.exp(-(t - b))) ? 1 : 0)));
}
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};

test('Rasch JMLE recovers known difficulties and abilities', { skip: !R }, () => {
  const bs = Array.from({ length: 20 }, (_, i) => -2 + (4 * i) / 19);
  const thetas = Array.from({ length: 400 }, (_, i) => -2.5 + (5 * ((i * 37) % 400)) / 400);
  const fit = R.rasch({ responses: simulate(thetas, bs) });
  assert.ok(fit.converged, `converged in ${fit.iterations}`);
  assert.ok(corr(fit.b, bs) > 0.97, `item r = ${corr(fit.b, bs).toFixed(3)}`);
  assert.ok(corr(fit.theta, thetas) > 0.85, `person r = ${corr(fit.theta, thetas).toFixed(3)}`);
  const mean = fit.b.reduce((a, x) => a + x, 0) / fit.b.length;
  assert.ok(Math.abs(mean) < 1e-6, 'without anchors the items are centred on 0');
});

test('Anchors stay fixed and carry the scale (equating)', { skip: !R }, () => {
  const bs = Array.from({ length: 16 }, (_, i) => -1.5 + (3 * i) / 15 + 0.7); // the "true" scale is shifted by +0.7
  const thetas = Array.from({ length: 300 }, (_, i) => -2 + (4 * ((i * 53) % 300)) / 300);
  const fixed = new Map([[0, bs[0]], [5, bs[5]], [10, bs[10]], [15, bs[15]]]);
  const fit = R.rasch({ responses: simulate(thetas, bs, 11), fixed });
  for (const [i, v] of fixed) assert.equal(fit.b[i], v, `anchor ${i} never moves`);
  const free = fit.b.map((b, i) => b - bs[i]).filter((_, i) => !fixed.has(i));
  const bias = free.reduce((a, x) => a + x, 0) / free.length;
  assert.ok(Math.abs(bias) < 0.25, `free items land on the anchored scale (bias ${bias.toFixed(3)})`);
});

test('Extreme scores still get a finite theta and SE', { skip: !R }, () => {
  const fit = R.rasch({ responses: [[1, 1, 1, 1], [0, 0, 0, 0], [1, 0, 1, 0], [1, 1, 0, 0]] });
  assert.ok(fit.theta.every(Number.isFinite) && fit.thetaSe.every((s) => Number.isFinite(s) && s > 0));
  assert.ok(fit.theta[0] > fit.theta[2] && fit.theta[2] > fit.theta[1]);
});

test('Scoring with known difficulties; inflation needs 30 pairs (M9-c)', { skip: !R }, () => {
  const one = R.estimateTheta([1, 1, 0, null, 1], [-1, 0, 1, 2, -0.5]);
  assert.ok(one && Number.isFinite(one.theta) && one.se > 0);
  assert.equal(R.estimateTheta([null, null], [0, 0]), null);
  const pairs = Array.from({ length: 29 }, () => ({ monitoring: 1, final: 0.6 }));
  assert.equal(R.inflationDelta(pairs), null);
  assert.ok(Math.abs(R.inflationDelta([...pairs, { monitoring: 1, final: 0.6 }]) - 0.4) < 1e-9);
});
