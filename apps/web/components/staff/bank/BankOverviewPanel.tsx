import type { BankOverview, BankTile } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import type { BankMessages } from '@/messages/bank';
import { TargetsEditor } from './TargetsEditor';

/** design/11: "30–40% is a normal rate" — above that the chip turns amber. */
const NORMAL_REJECTION = 0.4;
/** Writing target = approved target / (1 − rejection), at the upper normal rate. */
const KEEP_RATE = 1 - 0.35;

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 1000) / 10 : 0;
}

function Tile({ tile, m }: { tile: BankTile; m: BankMessages }) {
  const { grade, target, approved, accepted, inReview, draft } = tile;
  const t = m.tiles;
  // Bars are relative to the target; with no target (or overflow) to the total,
  // so the bar never spills out of its track.
  const scale = Math.max(target ?? 0, approved + accepted + inReview + draft, 1);
  const need = target === null ? null : target - approved;
  const aria = fill(t.tileAria, {
    g: grade,
    a: approved,
    c: accepted,
    r: inReview,
    d: draft,
    n: target ?? t.noTarget,
  });

  return (
    <li className="bk-tile">
      <div className="bk-tile__head">
        <span className="bk-tile__grade">{fill(m.common.gradeN, { g: grade })}</span>
        <span className={need !== null && need <= 0 ? 'bk-tile__need bk-tile__need--done' : 'bk-tile__need'}>
          {need === null ? t.noTarget : need > 0 ? fill(t.need, { n: need }) : t.needDone}
        </span>
      </div>
      <div className="bk-tile__count">
        <strong>{approved}</strong>
        {target !== null && <span>{fill(t.ofTarget, { n: target })}</span>}
      </div>
      <div className="bk-bar" role="img" aria-label={aria}>
        <span className="bk-bar__seg bk-bar__seg--approved" style={{ width: `${pct(approved, scale)}%` }} />
        <span className="bk-bar__seg bk-bar__seg--accepted" style={{ width: `${pct(accepted, scale)}%` }} />
        <span className="bk-bar__seg bk-bar__seg--review" style={{ width: `${pct(inReview, scale)}%` }} />
        <span className="bk-bar__seg bk-bar__seg--draft" style={{ width: `${pct(draft, scale)}%` }} />
      </div>
      <p className="bk-tile__legend">{fill(t.tileLegend, { c: accepted, r: inReview, d: draft })}</p>
    </li>
  );
}

/**
 * design/11 header band, shown to reviewers and the bank editor only (an
 * author's list comes back with `overview: null`). The editor may change the
 * five per-grade targets in place.
 */
export function BankOverviewPanel({
  overview,
  m,
  canEditTargets,
}: {
  overview: BankOverview;
  m: BankMessages;
  canEditTargets: boolean;
}) {
  const t = m.tiles;
  const { totals, tiles } = overview;
  const targetSum = tiles.reduce((s, x) => s + (x.target ?? 0), 0);
  const hasTarget = tiles.some((x) => x.target !== null);
  const writeAbout = Math.round(targetSum / KEEP_RATE / 10) * 10;
  const rate = totals.decided > 0 ? totals.rejected / totals.decided : null;

  return (
    <section className="bk-overview" aria-labelledby="bk-season-h">
      <div className="bk-overview__top">
        <div className="bk-season">
          <h2 id="bk-season-h" className="bk-season__title">
            {hasTarget ? fill(t.seasonTitle, { n: targetSum }) : t.seasonNoTarget}
          </h2>
          {hasTarget && (
            <p className="bk-season__sub">{fill(t.seasonSub, { w: writeAbout, written: totals.written })}</p>
          )}
          {canEditTargets && (
            <TargetsEditor
              m={m}
              tiles={tiles.map((x) => ({ grade: x.grade, target: x.target }))}
              hasSeason={overview.season !== null}
            />
          )}
        </div>
        <div className="bk-rej">
          <span className="bk-rej__pct">
            {rate === null ? '—' : `${Math.round(rate * 100)}%`}
          </span>
          <div className="fam-stack" style={{ ['--gap' as string]: '4px' }}>
            <p className="bk-rej__title">
              {t.rejTitle}
              {rate !== null && (
                <span className={rate <= NORMAL_REJECTION ? 'chip chip--success' : 'chip chip--warning'}>
                  {rate <= NORMAL_REJECTION ? t.rejChipOk : t.rejChipHigh}
                </span>
              )}
            </p>
            <p className="bk-rej__body">
              {rate === null
                ? t.rejNone
                : fill(t.rejBody, { rejected: totals.rejected, decided: totals.decided })}
            </p>
          </div>
        </div>
      </div>

      <ul className="bk-tiles">
        {[...tiles]
          .sort((a, b) => a.grade - b.grade)
          .map((tile) => (
            <Tile key={tile.grade} tile={tile} m={m} />
          ))}
      </ul>

      <div className="bk-legend">
        <ul className="bk-legend__keys">
          <li>
            <span className="bk-dot bk-bar__seg--approved" aria-hidden="true" />
            {t.lgApproved}
          </li>
          <li>
            <span className="bk-dot bk-bar__seg--accepted" aria-hidden="true" />
            {t.lgAccepted}
          </li>
          <li>
            <span className="bk-dot bk-bar__seg--review" aria-hidden="true" />
            {t.lgReview}
          </li>
          <li>
            <span className="bk-dot bk-bar__seg--draft" aria-hidden="true" />
            {t.lgDraft}
          </li>
        </ul>
        <span className="bk-legend__note">{t.lgNote}</span>
      </div>
    </section>
  );
}
