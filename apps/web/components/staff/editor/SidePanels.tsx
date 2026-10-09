'use client';

import { Icon } from '@/components/shell/Icon';
import type { ItemCard, ItemVersion } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { formatNum } from './shared';

const VERDICT_TAG = {
  accept: 'fam-tag fam-tag--ok',
  revise: 'fam-tag fam-tag--warn',
  reject: 'fam-tag fam-tag--danger',
  auto_reject: 'fam-tag fam-tag--danger',
} as const;

/**
 * design/12 "Version history", newest first. Each row opens that version; the
 * reviewer's verdict and note sit under the version they judged, so an author
 * told to "revise" reads why right here.
 */
export function VersionHistory({
  card,
  viewIdx,
  onPick,
  m,
  locale,
}: {
  card: ItemCard;
  viewIdx: number;
  onPick: (i: number) => void;
  m: EditorMessages;
  locale: Locale;
}) {
  return (
    <section className="fam-panel" aria-labelledby="ie-hist-h">
      <h2 id="ie-hist-h" className="ie-kicker">
        {m.hist.title}
      </h2>
      <ol className="ie-hist">
        {card.versions.map((v, i) => {
          const on = i === viewIdx;
          return (
            <li key={v.id} className="ie-hist__row" data-on={on ? 'true' : undefined}>
              <button
                type="button"
                className="ie-hist__btn"
                onClick={() => onPick(i)}
                aria-current={on ? 'true' : undefined}
                aria-label={fill(m.hist.pick, { n: v.version })}
              >
                <span className="ie-hist__ver">v{v.version}</span>
                <span className="ie-hist__body">
                  <span className="ie-hist__title">
                    {v.frozenAt ? fill(m.hist.frozenOn, { date: formatDate(v.frozenAt, locale) }) : m.hist.open}
                    {v.frozenAt && <Icon name="lock" size={14} />}
                    {on && <span className="fam-tag fam-tag--brand">{m.hist.viewing}</span>}
                  </span>
                  <span className="ie-hist__meta">
                    {fill(m.hist.created, { date: formatDate(v.createdAt, locale), name: v.createdByName })}
                  </span>
                  {v.submittedAt && (
                    <span className="ie-hist__meta">{fill(m.hist.submitted, { date: formatDate(v.submittedAt, locale) })}</span>
                  )}
                </span>
              </button>
              {v.reviews.length > 0 && (
                <ul className="ie-reviews">
                  {v.reviews.map((r) => (
                    <li key={r.id} className="ie-review">
                      <span className={VERDICT_TAG[r.verdict]}>{m.hist.verdict[r.verdict]}</span>
                      <span className="ie-hist__meta">
                        {fill(m.hist.reviewBy, { name: r.reviewerName, date: formatDate(r.decidedAt, locale) })}
                      </span>
                      {r.blindWasCorrect === false && <span className="ie-hist__meta">{m.hist.blindWrong}</span>}
                      {r.note && <q className="ie-review__note">{r.note}</q>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <p className="fam-small fam-muted">{m.hist.note}</p>
    </section>
  );
}

/** design/12 "Calibration" — empty until M5/M9 runs exist. */
export function CalibrationPanel({ version, m, locale }: { version: ItemVersion; m: EditorMessages; locale: Locale }) {
  const st = version.stats;
  const n = (s: string | null) => (s === null ? '—' : formatNum(Number(s), locale));
  return (
    <section className="fam-panel" aria-labelledby="ie-cal-h">
      <h2 id="ie-cal-h" className="fam-panel__title">
        {fill(m.cal.title, { n: version.version })}
      </h2>
      {!st ? (
        <div className="ie-empty">
          <span className="state__icon state__icon--empty">
            <Icon name="gauge" size={22} />
          </span>
          <strong>{m.cal.emptyTitle}</strong>
          <p className="fam-small fam-muted">{m.cal.emptyBody}</p>
        </div>
      ) : (
        <>
          <p className="fam-panel__sub">{fill(m.cal.sub, { method: st.method, date: formatDate(st.runAt, locale) })}</p>
          <div className="ie-stats">
            <Stat label={m.cal.n} value={String(st.n)} />
            <Stat label={m.cal.p} value={n(st.p)} sub={m.cal.pSub} />
            <Stat label={m.cal.r} value={n(st.pointBiserial)} sub={m.cal.rSub} />
            <Stat label={m.cal.dif} value={n(st.difUzRu)} sub={m.cal.difSub} />
          </div>
          {Object.keys(st.distractorShare ?? {}).length > 0 && (
            <div className="fam-stack" style={{ ['--gap' as string]: '10px' }}>
              <h3 className="ie-kicker">{m.cal.dist}</h3>
              {Object.entries(st.distractorShare).map(([k, share]) => {
                // Shares are fractions (0–1) from the calibration run.
                const pct = Math.round(Number(share) * 100);
                return (
                  <div key={k} className="ie-bar">
                    <span className="ie-bar__label">
                      <span>{k}</span>
                      <span>{pct}%</span>
                    </span>
                    <span className="ie-bar__track" aria-hidden="true">
                      <span className="ie-bar__fill" style={{ width: `${Math.min(100, pct)}%` }} />
                    </span>
                  </div>
                );
              })}
              <p className="fam-small fam-muted">{m.cal.distNote}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ie-stat">
      <span className="ie-stat__label">{label}</span>
      <span className="ie-stat__value">{value}</span>
      {sub && <span className="ie-stat__sub">{sub}</span>}
    </div>
  );
}

/** design/12 payment note: authors are paid per *accepted* item (`accepted_at`). */
export function PayNote({ card, m }: { card: ItemCard; m: EditorMessages }) {
  return (
    <section className="fam-panel ie-pay" aria-labelledby="ie-pay-h">
      <span className="ie-pay__icon" aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <div className="fam-stack" style={{ ['--gap' as string]: '6px' }}>
        <h2 id="ie-pay-h" className="ie-pay__title">
          {m.pay.title}
        </h2>
        <p className="fam-small fam-muted">{m.pay.body}</p>
        <p className="fam-small">{fill(m.pay.me, { author: card.authorName, n: card.authorAcceptedThisSeason })}</p>
      </div>
    </section>
  );
}
