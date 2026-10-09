import type { RuleId, SlotRole } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';

export type Band = 'easy' | 'medium' | 'hard';

/**
 * easy / medium / hard — the same cut-offs as the API's rule check
 * (apps/api/src/bank/form-rules.ts `band`), so a tile and the rule agree.
 */
export function band(s: { difficultyB: number | null; expectedP: number | null }): Band | null {
  if (s.difficultyB !== null) return s.difficultyB < -1 ? 'easy' : s.difficultyB > 1 ? 'hard' : 'medium';
  if (s.expectedP !== null) return s.expectedP >= 0.7 ? 'easy' : s.expectedP < 0.4 ? 'hard' : 'medium';
  return null;
}

/** "−1,2" (uz/ru) or "−1.2" (en): a real minus sign, the locale's decimal mark. */
export function formatB(b: number, locale: Locale): string {
  const abs = Math.abs(b).toFixed(1);
  const num = locale === 'en' ? abs : abs.replace('.', ',');
  return b < 0 ? `−${num}` : b > 0 ? `+${num}` : num;
}

/** One line of difficulty: calibrated b when there is one, else the author's expected p. */
export function difficultyText(
  s: { difficultyB: number | null; expectedP: number | null },
  m: FormsMessages,
  locale: Locale,
): string {
  const d = band(s);
  if (s.difficultyB !== null) return fill(m.slot.bFmt, { b: formatB(s.difficultyB, locale), d: d ? m.slot[d] : '' });
  if (s.expectedP !== null) return fill(m.slot.notCalib, { p: Math.round(s.expectedP * 100) });
  return m.slot.noDifficulty;
}

/** `G4-NUM-0012` → `NUM-0012`: what fits on a position tile. */
export function codeTail(code: string): string {
  return code.split('-').slice(1).join('-') || code;
}

export function roleName(role: SlotRole, m: FormsMessages): string {
  return m.role[role];
}

export const RULE_TITLE: Record<RuleId, keyof FormsMessages['rules']> = {
  filled: 'filled',
  slots_valid: 'slotsValid',
  anchors_spread: 'spread',
  anchors_middle: 'middle',
  pretest_unscored: 'pretest',
  cluster_coverage: 'cluster',
  no_anchor_in_practice: 'noAnchor',
  bilingual: 'bilingual',
};

/** API error → copy. FORM_STATE / SLOT_INVALID carry a `reason`. */
export function formErrorText(
  err: { code: string; details: Record<string, unknown> } | unknown,
  m: FormsMessages,
): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return m.errors.generic;
  const e = err as { code: string; details: Record<string, unknown> };
  const known = m.errors as Record<string, string>;
  const reason = typeof e.details?.reason === 'string' ? e.details.reason : '';
  if (reason === 'rules_failing') {
    const failing = Array.isArray(e.details.failing) ? (e.details.failing as RuleId[]) : [];
    return fill(m.errors.rules_failing, {
      list: failing.map((id) => (RULE_TITLE[id] ? m.rules[RULE_TITLE[id]] : id)).join('; '),
    });
  }
  return known[reason] ?? known[e.code] ?? m.errors.generic;
}
