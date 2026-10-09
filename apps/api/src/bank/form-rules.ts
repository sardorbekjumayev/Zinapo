/**
 * The rule checks a form must pass before it can be frozen (task.md § 8.5,
 * design/14). Pure functions over the form's plan and filled slots, so the
 * same verdict is shown on screen and enforced by `freeze`.
 */

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
  /** False when the rule does not apply to this mode (shown, never failing). */
  applicable: boolean;
  ok: boolean;
  details: Record<string, unknown>;
}

export interface PlanSlot {
  position: number;
  role: 'scored' | 'anchor' | 'pretest';
}

export interface FilledSlot {
  position: number;
  slotRole: 'scored' | 'anchor' | 'pretest';
  isScored: boolean;
  code: string;
  cluster: string;
  isAnchor: boolean;
  status: string;
  retired: boolean;
  expectedP: number | null;
  difficultyB: number | null;
  bilingual: boolean;
}

/** task.md § 8.5: "6–8 items per cluster". The floor is what we enforce. */
export const MIN_PER_CLUSTER = 6;
/** task.md § 8.5: "4–5 unscored pretest items". */
export const PRETEST_RANGE = [4, 5] as const;

/** easy / medium / hard — from calibrated b when there is one, else the author's expected p. */
export function band(s: Pick<FilledSlot, 'difficultyB' | 'expectedP'>): 'easy' | 'medium' | 'hard' | null {
  if (s.difficultyB !== null) return s.difficultyB < -1 ? 'easy' : s.difficultyB > 1 ? 'hard' : 'medium';
  if (s.expectedP !== null) return s.expectedP >= 0.7 ? 'easy' : s.expectedP < 0.4 ? 'hard' : 'medium';
  return null;
}

/**
 * "Anchors in the middle positions" (task.md § 8.5). Children tire towards the
 * end, so an anchor there behaves differently from the same anchor in another
 * wave. The middle is the second and third quarter: for 30 positions, 8–23 —
 * design/14's template puts its 12 anchors in 10–21.
 */
export function middleWindow(total: number): [number, number] {
  return [Math.floor(total * 0.25) + 1, Math.ceil(total * 0.75)];
}

export function checkForm(input: {
  mode: 'monitoring' | 'practice' | 'olympiad';
  plan: PlanSlot[];
  slots: FilledSlot[];
  /** Clusters that have at least one topic covering this grade. */
  clustersForGrade: string[];
}): RuleResult[] {
  const { mode, plan, slots } = input;
  const monitoring = mode !== 'practice';
  const total = Math.max(plan.length, ...slots.map((s) => s.position), 0);
  const anchors = slots.filter((s) => s.slotRole === 'anchor');
  const pretest = slots.filter((s) => s.slotRole === 'pretest');
  const scored = slots.filter((s) => s.isScored);

  const out: RuleResult[] = [];

  const filled = new Set(slots.map((s) => s.position));
  const missing = plan.filter((p) => !filled.has(p.position)).map((p) => p.position);
  out.push({
    id: 'filled',
    applicable: true,
    ok: total > 0 && missing.length === 0,
    details: { filled: slots.length, total, missing },
  });

  // Each slot still holds an item that is allowed there today: not retired,
  // approved for scored/anchor slots, accepted (or better) for pretest.
  const invalid = slots
    .filter(
      (s) =>
        s.retired ||
        (s.slotRole === 'pretest' ? !['accepted', 'approved'].includes(s.status) : s.status !== 'approved') ||
        (s.slotRole === 'anchor' && !s.isAnchor),
    )
    .map((s) => ({ position: s.position, code: s.code }));
  out.push({ id: 'slots_valid', applicable: true, ok: invalid.length === 0, details: { invalid } });

  const bands = { easy: 0, medium: 0, hard: 0, unknown: 0 };
  for (const a of anchors) bands[band(a) ?? 'unknown'] += 1;
  out.push({
    id: 'anchors_spread',
    applicable: monitoring,
    ok: !monitoring || (anchors.length >= 3 && bands.easy > 0 && bands.medium > 0 && bands.hard > 0),
    details: { ...bands, count: anchors.length, source: anchors.some((a) => a.difficultyB !== null) ? 'b' : 'expected_p' },
  });

  const [lo, hi] = middleWindow(total);
  const outside = anchors.filter((a) => a.position < lo || a.position > hi).map((a) => ({ position: a.position, code: a.code }));
  out.push({
    id: 'anchors_middle',
    applicable: monitoring,
    ok: !monitoring || (anchors.length > 0 && outside.length === 0),
    details: { window: [lo, hi], outside },
  });

  const scoredPretest = pretest.filter((s) => s.isScored).length;
  out.push({
    id: 'pretest_unscored',
    applicable: true,
    ok:
      scoredPretest === 0 &&
      (!monitoring || (pretest.length >= PRETEST_RANGE[0] && pretest.length <= PRETEST_RANGE[1])),
    details: { count: pretest.length, range: monitoring ? PRETEST_RANGE : null, scoredPretest },
  });

  const counts: Record<string, number> = {};
  for (const c of input.clustersForGrade) counts[c] = 0;
  for (const s of scored) counts[s.cluster] = (counts[s.cluster] ?? 0) + 1;
  const short = Object.entries(counts).filter(([, n]) => n < MIN_PER_CLUSTER).map(([c]) => c);
  out.push({
    id: 'cluster_coverage',
    applicable: monitoring,
    ok: !monitoring || short.length === 0,
    details: { counts, required: MIN_PER_CLUSTER, short },
  });

  const anchorItems = slots.filter((s) => s.isAnchor).map((s) => ({ position: s.position, code: s.code }));
  out.push({
    id: 'no_anchor_in_practice',
    applicable: !monitoring,
    ok: monitoring || anchorItems.length === 0,
    details: { anchors: anchorItems },
  });

  const notBilingual = slots.filter((s) => !s.bilingual).map((s) => ({ position: s.position, code: s.code }));
  out.push({
    id: 'bilingual',
    applicable: true,
    ok: notBilingual.length === 0,
    details: { total: slots.length, both: slots.length - notBilingual.length, missing: notBilingual },
  });

  return out;
}

/**
 * design/14's "Create from template". Monitoring: 30 positions — 12 anchors in
 * the middle (10–21), 5 pretest, 13 core. Practice: 18 positions — 13 core and
 * 5 pretest, no anchors.
 */
export function templatePlan(mode: 'monitoring' | 'practice' | 'olympiad'): PlanSlot[] {
  if (mode === 'practice') {
    const pretest = new Set([4, 8, 11, 14, 17]);
    return Array.from({ length: 18 }, (_, i) => ({
      position: i + 1,
      role: pretest.has(i + 1) ? 'pretest' : 'scored',
    }));
  }
  const pretest = new Set([5, 8, 23, 25, 27]);
  return Array.from({ length: 30 }, (_, i) => {
    const pos = i + 1;
    return {
      position: pos,
      role: pos >= 10 && pos <= 21 ? 'anchor' : pretest.has(pos) ? 'pretest' : 'scored',
    };
  });
}
