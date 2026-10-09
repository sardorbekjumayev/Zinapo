import { Icon } from '@/components/shell/Icon';
import type { FormView, RuleResult } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { RULE_TITLE } from './shared';

type Pos = { position: number; code: string };

/** The first few, then "+n" — a rule line stays one or two lines long. */
function posList(xs: Pos[], m: FormsMessages, max = 3): string {
  const shown = xs.slice(0, max).map((x) => fill(m.rules.posFmt, { code: x.code, n: x.position }));
  return xs.length > max ? `${shown.join(', ')} +${xs.length - max}` : shown.join(', ');
}

function numList(xs: number[], max = 10): string {
  return xs.length > max ? `${xs.slice(0, max).join(', ')}…` : xs.join(', ');
}

/** The sentence under a rule's title, built from the API's `details` (design/14 r1–r6). */
function detail(r: RuleResult, form: FormView, m: FormsMessages): string {
  const d = r.details as Record<string, never>;
  const practice = form.mode === 'practice';
  switch (r.id) {
    case 'filled': {
      const total = d.total as number;
      if (total === 0) return m.rules.filledNone;
      return r.ok
        ? fill(m.rules.filledOk, { total })
        : fill(m.rules.filledFail, { filled: d.filled, total, list: numList(d.missing as number[]) });
    }
    case 'slots_valid':
      return r.ok ? m.rules.slotsValidOk : fill(m.rules.slotsValidFail, { list: posList(d.invalid as Pos[], m) });
    case 'anchors_spread': {
      if (!r.applicable) return m.rules.naAnchors;
      let s = fill(m.rules.spreadFmt, { count: d.count, easy: d.easy, medium: d.medium, hard: d.hard });
      if ((d.unknown as number) > 0) s += fill(m.rules.spreadUnknown, { n: d.unknown });
      if (d.source === 'expected_p' && (d.count as number) > 0) s += m.rules.spreadP;
      return r.ok ? s : `${s}. ${m.rules.spreadFail}`;
    }
    case 'anchors_middle': {
      if (!r.applicable) return m.rules.naAnchors;
      const [lo, hi] = d.window as [number, number];
      const outside = d.outside as Pos[];
      const count = form.slots.filter((s) => s.slotRole === 'anchor').length;
      if (outside.length > 0) return fill(m.rules.middleFail, { list: posList(outside, m), lo, hi });
      return count === 0 ? fill(m.rules.middleNone, { lo, hi }) : fill(m.rules.middleOk, { count, lo, hi });
    }
    case 'pretest_unscored': {
      const count = d.count as number;
      if ((d.scoredPretest as number) > 0) return fill(m.rules.pretestScored, { n: d.scoredPretest });
      const range = d.range as [number, number] | null;
      if (!r.ok && range) return fill(m.rules.pretestRange, { count, lo: range[0], hi: range[1] });
      return fill(practice ? m.rules.pretestOkPr : m.rules.pretestOk, { count });
    }
    case 'cluster_coverage': {
      if (!r.applicable) return m.rules.naCluster;
      const counts = d.counts as Record<string, number>;
      const name = (c: string) => (m.cluster as Record<string, string>)[c] ?? c;
      const list = Object.entries(counts)
        .map(([c, n]) => `${name(c)} ${n}`)
        .join(' · ');
      return r.ok
        ? fill(m.rules.clusterOk, { list })
        : fill(m.rules.clusterFail, { list, required: d.required, short: (d.short as string[]).map(name).join(', ') });
    }
    case 'no_anchor_in_practice':
      if (!r.applicable) return m.rules.noAnchorMon;
      return r.ok
        ? fill(m.rules.noAnchorOk, { n: form.slots.length })
        : fill(m.rules.noAnchorFail, { list: posList(d.anchors as Pos[], m) });
    case 'bilingual': {
      const total = d.total as number;
      if (total === 0) return m.rules.bilingualNone;
      return r.ok
        ? fill(m.rules.bilingualOk, { total, both: d.both })
        : fill(m.rules.bilingualFail, { total, both: d.both, list: posList(d.missing as Pos[], m) });
    }
  }
}

/**
 * design/14 "Rule checks": one row per rule from the API — the same verdict
 * that `freeze` enforces. A rule that doesn't apply to this mode is shown
 * greyed as "not applicable", never as failing.
 */
export function RuleChecks({ form, m }: { form: FormView; m: FormsMessages }) {
  const applicable = form.rules.filter((r) => r.applicable);
  const passing = applicable.filter((r) => r.ok).length;
  const allOk = passing === applicable.length;

  return (
    <section className="fam-panel" aria-labelledby="fb-rules-title">
      <div className="fb-rulesHead">
        <h2 id="fb-rules-title" className="fam-panel__title">
          {m.rules.title}
        </h2>
        <span className={allOk ? 'fb-count fb-count--ok' : 'fb-count fb-count--bad'}>
          {fill(m.rules.countFmt, { n: passing, m: applicable.length })}
        </span>
      </div>
      <ul className="fb-rules">
        {form.rules.map((r) => {
          const state = !r.applicable ? 'na' : r.ok ? 'ok' : 'fail';
          return (
            <li key={r.id} className="fb-rule" data-state={state}>
              <span className="fb-rule__icon" aria-hidden="true">
                <Icon name={state === 'ok' ? 'check' : state === 'fail' ? 'x' : 'info'} size={14} />
              </span>
              <div className="fam-stack" style={{ '--gap': '2px', minWidth: 0 } as React.CSSProperties}>
                <span className="fb-rule__title">
                  {m.rules[RULE_TITLE[r.id]]}
                  <span className="visually-hidden">
                    {' '}
                    — {state === 'ok' ? m.rules.pass : state === 'fail' ? m.rules.fail : m.rules.na}
                  </span>
                </span>
                <span className="fam-small fb-rule__detail">{detail(r, form, m)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
