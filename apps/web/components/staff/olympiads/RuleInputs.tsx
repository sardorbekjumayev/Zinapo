'use client';

import type { OlympiadsMessages } from '@/messages/olympiads';

export const RULE_KEYS = ['certificateTopPct', 'qualifyTopPct', 'miniFinalTopN', 'bonusRate', 'cupTopN'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export type RuleDraft = Record<RuleKey, string>;

/** The API's limits (apps/api/src/olympiad/olympiad.dto.ts) — checked here first for a field-level message. */
const LIMITS: Record<RuleKey, { min: number; max: number }> = {
  certificateTopPct: { min: 1, max: 50 },
  qualifyTopPct: { min: 1, max: 100 },
  miniFinalTopN: { min: 1, max: 100_000 },
  bonusRate: { min: 0, max: 1_000_000_000 },
  cupTopN: { min: 1, max: 20 },
};

/** The API's defaults for a new olympiad (olympiad-admin.service.ts `create`). */
export const DEFAULT_RULES: RuleDraft = {
  certificateTopPct: '15',
  qualifyTopPct: '30',
  miniFinalTopN: '100',
  bonusRate: '0',
  cupTopN: '3',
};

export function ruleDraftOf(o: Record<RuleKey, number>): RuleDraft {
  return Object.fromEntries(RULE_KEYS.map((k) => [k, String(o[k])])) as RuleDraft;
}

/** The keys whose value is not a whole number in range. */
export function invalidRules(d: RuleDraft): RuleKey[] {
  return RULE_KEYS.filter((k) => {
    const v = d[k].trim();
    if (!/^\d+$/.test(v)) return true;
    const n = Number(v);
    return n < LIMITS[k].min || n > LIMITS[k].max;
  });
}

export function ruleValues(d: RuleDraft): Record<RuleKey, number> {
  return Object.fromEntries(RULE_KEYS.map((k) => [k, Number(d[k].trim())])) as Record<RuleKey, number>;
}

const LABELS: Record<RuleKey, { lbl: keyof OlympiadsMessages['rules']; hint: keyof OlympiadsMessages['rules'] }> = {
  certificateTopPct: { lbl: 'certLbl', hint: 'certHint' },
  qualifyTopPct: { lbl: 'qualifyLbl', hint: 'qualifyHint' },
  miniFinalTopN: { lbl: 'miniLbl', hint: 'miniHint' },
  bonusRate: { lbl: 'bonusLbl', hint: 'bonusHint' },
  cupTopN: { lbl: 'cupLbl', hint: 'cupHint' },
};

/** The five numbers of § 8.5 "Olympiad operator" — shared by "New olympiad" and the rules panel. */
export function RuleInputs({
  idPrefix,
  draft,
  invalid,
  onChange,
  m,
}: {
  idPrefix: string;
  draft: RuleDraft;
  invalid: RuleKey[];
  onChange: (next: RuleDraft) => void;
  m: OlympiadsMessages;
}) {
  return (
    <div className="oa-rules">
      {RULE_KEYS.map((k) => {
        const id = `${idPrefix}-${k}`;
        const bad = invalid.includes(k);
        return (
          <div key={k} className="fam-field">
            <label className="fam-label" htmlFor={id}>
              {m.rules[LABELS[k].lbl] as string}
            </label>
            <input
              id={id}
              className="fam-input mono"
              inputMode="numeric"
              value={draft[k]}
              aria-invalid={bad || undefined}
              aria-describedby={`${id}-h`}
              onChange={(e) => onChange({ ...draft, [k]: e.target.value })}
            />
            <span id={`${id}-h`} className={bad ? 'fam-caption fam-caption--bad' : 'fam-caption'}>
              {bad ? m.rules.numErr : (m.rules[LABELS[k].hint] as string)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
