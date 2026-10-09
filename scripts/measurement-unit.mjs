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
