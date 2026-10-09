import type { FormSlot, FormView } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { difficultyText } from './shared';

/**
 * Where an item sits on "easier → harder", 0..1. Calibrated b (−3..+3) when
 * there is one; until calibration exists (M5/M9) the author's expected p,
 * flipped so that a high p is on the easy side.
 */
function place(s: FormSlot): number | null {
  const clamp = (x: number) => Math.min(0.98, Math.max(0.02, x));
  if (s.difficultyB !== null) return clamp((s.difficultyB + 3) / 6);
  if (s.expectedP !== null) return clamp(1 - s.expectedP);
  return null;
}

function Row({
  kind,
  label,
  slots,
  m,
  locale,
}: {
  kind: 'anchor' | 'core';
  label: string;
  slots: FormSlot[];
  m: FormsMessages;
  locale: Locale;
}) {
  const placed = slots.map((s) => ({ s, x: place(s) })).filter((d): d is { s: FormSlot; x: number } => d.x !== null);
  return (
    <div className="fb-strip__row" data-kind={kind}>
      <span className="fb-strip__label">{label}</span>
      {placed.length === 0 ? (
        <span className="fb-strip__track fb-strip__track--empty fam-small fam-muted">{m.strip.none}</span>
      ) : (
        <ul className="fb-strip__track" aria-label={label}>
          {placed.map(({ s, x }) => (
            <li
              key={s.position}
              className="fb-strip__dot"
              style={{ left: `${x * 100}%` }}
              title={fill(m.strip.dotFmt, { code: s.code, d: difficultyText(s, m, locale) })}
            >
              <span className="visually-hidden">{fill(m.strip.dotFmt, { code: s.code, d: difficultyText(s, m, locale) })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** design/14 "Difficulty spread": anchors (monitoring only) and core items along easier → harder. */
export function DifficultyStrip({ form, m, locale }: { form: FormView; m: FormsMessages; locale: Locale }) {
  const practice = form.mode === 'practice';
  const anchors = form.slots.filter((s) => s.slotRole === 'anchor');
  const core = form.slots.filter((s) => s.slotRole === 'scored');
  const pretest = form.plan.filter((p) => p.role === 'pretest').length;
  const uncalibrated = [...anchors, ...core].some((s) => s.difficultyB === null);

  return (
    <section className="fam-panel fb-strip" aria-labelledby="fb-strip-title">
      <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
        <h2 id="fb-strip-title" className="fam-panel__title">
          {m.strip.title}
        </h2>
        <p className="fam-small fam-muted">{practice ? m.strip.subPr : m.strip.sub}</p>
      </div>
      {practice ? (
        <div className="fb-strip__row">
          <span className="fb-strip__label">{m.strip.anchors}</span>
          <span className="fb-strip__track fb-strip__track--empty fam-small fam-muted">{m.strip.excluded}</span>
        </div>
      ) : (
        <Row kind="anchor" label={m.strip.anchors} slots={anchors} m={m} locale={locale} />
      )}
      <Row kind="core" label={m.strip.core} slots={core} m={m} locale={locale} />
      <div className="fb-strip__axis" aria-hidden="true">
        <span>← {m.strip.easier}</span>
        <span>{m.strip.harder} →</span>
      </div>
      {uncalibrated && <p className="fam-small fam-muted">{m.strip.byP}</p>}
      {pretest > 0 && <p className="fam-small fam-muted">{fill(m.strip.pretestNote, { n: pretest })}</p>}
    </section>
  );
}
