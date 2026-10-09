import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { ClusterStanding, Report34 as Report34Data, TopRange } from '@/lib/report-types';
import { reportMessages } from '@/messages/report';
import { ActionStart } from './ActionStart';
import { TrendChart, type TrendColumn } from './TrendChart';
import { PracticeCount, WhoCanSee } from './WhoCanSee';
import { axisMax, direction, pick } from './util';

const CLUSTERS = ['numeracy', 'reasoning', 'language'] as const;
const CHIP: Record<ClusterStanding, string> = {
  strength: 'fam-tag fam-tag--ok',
  in_line: 'fam-tag',
  weaker: 'fam-tag fam-tag--warn',
};

/**
 * The grade 3–4 report, design/03, in the order task.md § 8.1.3 fixes:
 * where are we → where heading → what's wrong → what to do; then Plan B,
 * who can see, practice. The position is only ever the API's "top X–Y%"
 * range (§ 1.9); nothing here derives a number of its own.
 */
export function Report34({
  r,
  locale,
  childId,
  owner,
}: {
  r: Report34Data;
  locale: Locale;
  childId: string;
  owner: boolean;
}) {
  const all = reportMessages(locale);
  const t = all.trend;
  const name = r.child.givenName;
  const latest = r.latest;
  const band = latest && !latest.belowMinimum && latest.top ? latest.top : null;
  const region = latest ? pick(locale, latest.regionUz, latest.regionRu) : '';
  const max = axisMax([band, ...r.trend.map((p) => p.top)]);
  const pct = (p: number) => `${(p / max) * 100}%`;
  const topLabel = (x: TopRange) => fill(all.hero.big, { from: x.from, to: x.to });

  // ----- trend columns, each with an honest note against the previous band
  let prev: TopRange | null = null;
  const drawn: TopRange[] = [];
  const columns: TrendColumn[] = r.trend.map((p) => {
    const base = {
      key: p.waveId,
      label: fill(all.common.wave, { n: p.ordinal }),
      sub: formatDate(p.opensAt, locale, false),
      state: p.state,
      top: null as TopRange | null,
    };
    if (p.state === 'measured') {
      if (!p.top || p.belowMinimum) return { ...base, position: t.below, note: t.notes.below };
      const note = prev ? t.notes[direction(prev, p.top)] : t.notes.first;
      prev = p.top;
      drawn.push(p.top);
      return { ...base, top: p.top, position: fill(t.colTop, { from: p.top.from, to: p.top.to }), note };
    }
    if (p.state === 'not_taken') return { ...base, position: t.notTaken, note: t.notes.notTaken };
    if (p.state === 'awaiting') return { ...base, position: t.awaiting, note: t.notes.awaiting };
    if (p.state === 'open') {
      const closes = r.next?.ordinal === p.ordinal ? r.next.closesAt : null;
      return closes
        ? { ...base, position: fill(t.open, { date: formatDate(closes, locale, false) }), note: fill(t.notes.open, { date: formatDate(closes, locale) }) }
        : { ...base, position: t.openNow, note: t.hintBody };
    }
    return {
      ...base,
      position: fill(t.upcoming, { date: formatDate(p.opensAt, locale, false) }),
      note: fill(t.notes.upcoming, { n: p.ordinal, date: formatDate(p.opensAt, locale) }),
    };
  });
  const lastDrawn = columns.map((c) => !!c.top).lastIndexOf(true);
  const firstFuture = columns.findIndex((c) => c.state === 'open' || c.state === 'upcoming');
  const initial = lastDrawn >= 0 ? lastDrawn : Math.max(0, firstFuture);
  const trendTitle =
    drawn.length === 0
      ? t.titleNone
      : drawn.length === 1
        ? t.titleFirst
        : { up: t.titleUp, steady: t.titleSteady, down: t.titleDown }[direction(drawn[drawn.length - 2], drawn[drawn.length - 1])];
  const ticks = (max === 50 ? [1, 5, 25, 50] : [5, 25, 50, 100]).map((p) => ({ p, label: fill(all.hero.tick, { p }) }));

  // ----- clusters and the one action
  const clusters = CLUSTERS.filter((c) => r.clusters?.[c]).map((c) => ({ key: c, standing: r.clusters![c]! }));
  const weaker = clusters.find((c) => c.standing === 'weaker');
  const pattern = r.pattern ?? null;
  const season = r.seasonPattern ?? null;
  const holdTitle =
    clusters.length === 0
      ? all.hold.titleNoData
      : weaker
        ? fill(all.hold.titleWeaker, { cluster: all.common.cluster[weaker.key] })
        : all.hold.titleNone;
  const actTitle = pattern
    ? fill(all.act.titlePattern, { topic: pick(locale, pattern.nameUz, pattern.nameRu) })
    : weaker
      ? fill(all.act.titleCluster, { topic: all.common.cluster[weaker.key] })
      : all.act.titleRoutine;

  const nextLine = r.next
    ? fill(r.next.open ? all.common.nextOpen : all.common.nextUpcoming, {
        n: r.next.ordinal,
        date: formatDate(r.next.open ? r.next.closesAt : r.next.opensAt, locale),
      })
    : all.common.nextNone;

  const left = Math.max(0, r.ticket.needed - r.ticket.taken);

  return (
    <div className="rp">
      {/* 1 · where are we */}
      <section className="fam-panel rp-hero" aria-labelledby="rp-hero-over">
        <div className="rp-hero__lead">
          <span id="rp-hero-over" className="rp-over">
            {fill(all.hero.over, { name })}
          </span>
          {band && latest ? (
            <>
              <p className="rp-hero__big">{topLabel(band)}</p>
              <p className="card__body">
                {fill(all.hero.sub, { n: latest.cohortN, g: r.child.grade, region, w: latest.ordinal })}
              </p>
            </>
          ) : (
            <>
              <p className="rp-hero__none">{all.hero.belowTitle}</p>
              <p className="card__body">
                {latest?.belowMinimum
                  ? fill(all.hero.belowBody, { n: latest.cohortN, min: latest.cohortMinimum, name, g: r.child.grade, region })
                  : all.hero.noBandBody}
              </p>
            </>
          )}
        </div>
        {band && (
          <div className="rp-hero__scale">
            <div
              className="rp-scale"
              role="img"
              aria-label={fill(all.hero.scaleAria, { from: band.from, to: band.to, max })}
            >
              <span className="rp-scale__zoneLabel" style={{ left: pct(5) }} aria-hidden="true">
                {all.hero.zone}
              </span>
              <div className="rp-scale__track" aria-hidden="true">
                <span className="rp-scale__zone" style={{ width: pct(5) }} />
                <span className="rp-scale__marker" style={{ left: pct(5) }} />
                <span
                  className="rp-scale__band"
                  style={{ left: pct(band.from), width: `max(14px, ${pct(band.to - band.from)})` }}
                >
                  <span className="rp-scale__who">{name}</span>
                </span>
              </div>
              <div className="rp-scale__ticks" aria-hidden="true">
                <span>{all.hero.strongest}</span>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i}>{fill(all.hero.tick, { p: (max / 5) * i })}</span>
                ))}
              </div>
            </div>
            <p className="fam-note fam-note--brand">
              <Icon name="info" size={18} />
              <span>{all.hero.rangeNote}</span>
            </p>
          </div>
        )}
      </section>

      <div className="rp-row">
        {/* 2 · where heading */}
        <section className="fam-panel" aria-labelledby="rp-trend-title">
          <div>
            <span className="rp-over">{fill(t.over, { name })}</span>
            <h2 id="rp-trend-title" className="fam-panel__title">
              {trendTitle}
            </h2>
          </div>
          {columns.length > 0 && (
            <TrendChart
              columns={columns}
              max={max}
              initial={initial}
              hint={t.hint}
              ticks={ticks}
              table={{ caption: t.tableCaption, wave: t.thWave, position: t.thPosition }}
            />
          )}
          <p className="rp-line">
            <Icon name="calendar" size={18} />
            <span>
              {r.next && <strong>{fill(r.next.open ? t.hintOpenTitle : t.hintUpTitle, { n: r.next.ordinal })} </strong>}
              {nextLine} {t.hintBody}
            </span>
          </p>
        </section>

        {/* the "5" in eMaktab, and the olympiad ticket */}
        <section className="fam-panel" aria-labelledby="rp-g5-title">
          <div>
            <span className="rp-over">{all.g5.over}</span>
            <h2 id="rp-g5-title" className="fam-panel__title">
              {all.g5.title}
            </h2>
          </div>
          <div className="rp-g5">
            <div className="rp-g5__tile">
              <span className="fam-small fam-muted">{all.g5.aLabel}</span>
              <span className="rp-g5__value">{all.g5.aValue}</span>
              <span className="fam-small fam-muted">{all.g5.aSub}</span>
            </div>
            <div className="rp-g5__tile">
              <span className="fam-small fam-muted">{all.g5.bLabel}</span>
              <span className={band ? 'rp-g5__value' : 'rp-g5__value rp-g5__value--none'}>
                {band ? topLabel(band) : all.g5.bNone}
              </span>
              <span className="fam-small fam-muted">{all.g5.bSub}</span>
            </div>
          </div>
          <p className="card__body rp-body">{fill(all.g5.body, { name })}</p>
          <p className="rp-line rp-line--top">
            <Icon name={left === 0 ? 'check' : 'trophy'} size={18} />
            <span>
              <strong>
                {left === 0
                  ? fill(all.g5.ticketDone, { taken: r.ticket.taken, needed: r.ticket.needed })
                  : fill(all.g5.ticketLeft, { taken: r.ticket.taken, needed: r.ticket.needed, left })}
              </strong>{' '}
              <Link href={`/${locale}/family/children/${childId}/olympiad`} className="rp-link rp-link--inline">
                {all.g5.ticketLink}
              </Link>
            </span>
          </p>
        </section>
      </div>

      {/* 3 · what's holding back */}
      <section className="fam-panel" aria-labelledby="rp-hold-title">
        <div className="rp-hold__head">
          <div>
            <span className="rp-over">{fill(all.hold.over, { name })}</span>
            <h2 id="rp-hold-title" className="fam-panel__title">
              {holdTitle}
            </h2>
          </div>
          <span className="fam-small fam-muted rp-hold__meta">{fill(all.hold.meta, { name })}</span>
        </div>
        {clusters.length > 0 && (
          <ul className="rp-clusters">
            {clusters.map((c) => (
              <li key={c.key} className={c.standing === 'weaker' ? 'rp-cluster rp-cluster--weaker' : 'rp-cluster'}>
                <span className={CHIP[c.standing]}>{all.hold.chip[c.standing]}</span>
                <strong>{all.common.cluster[c.key]}</strong>
                <span className="fam-small fam-muted">{all.hold.text[c.standing]}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="rp-pair">
          <div className="rp-pattern">
            <span className="rp-over rp-over--brand">{all.hold.patternOver}</span>
            {pattern ? (
              <>
                <h3 className="rp-h3">{pick(locale, pattern.nameUz, pattern.nameRu)}</h3>
                <p className="rp-body">{pick(locale, pattern.explainUz, pattern.explainRu)}</p>
                <p className="fam-small fam-muted">{all.hold.patternNote}</p>
              </>
            ) : (
              <p className="rp-body">{all.hold.patternNone}</p>
            )}
          </div>
          <div className="rp-pattern">
            <span className="rp-over rp-over--brand">{all.hold.seasonOver}</span>
            {season ? (
              <>
                <h3 className="rp-h3">{pick(locale, season.nameUz, season.nameRu)}</h3>
                <p className="rp-body">
                  {fill(all.hold.seasonBody, { waves: season.waves, of: season.of })}
                  {season.of > 1 && season.waves === season.of ? ` ${all.hold.seasonEvery}` : ''}
                </p>
              </>
            ) : (
              <p className="rp-body">{all.hold.seasonNone}</p>
            )}
          </div>
        </div>
      </section>

      <div className="rp-row">
        {/* 4 · what to do */}
        <section className="fam-panel rp-act" aria-labelledby="rp-act-title">
          <span className="rp-over">{all.act.over}</span>
          <h2 id="rp-act-title" className="rp-act__title">
            {actTitle}
          </h2>
          <p className="rp-act__body">
            {pattern ? fill(all.act.bodyPattern, { name }) : all.act.bodyRoutine}
            <strong>{all.act.question}</strong>
            {all.act.bodyEnd}
          </p>
          <div className="fam-inline">
            <span className="fam-tag fam-tag--brand">{all.act.days}</span>
            <span className="fam-tag fam-tag--brand">{all.act.minutes}</span>
            {r.next && <span className="fam-tag fam-tag--brand">{fill(all.act.until, { n: r.next.ordinal })}</span>}
          </div>
          <ActionStart
            storageKey={`zinapo.report.start.${childId}.${latest?.waveId ?? 'none'}`}
            copy={{ start: all.act.start, started: all.act.started, note: all.act.note, noteDone: all.act.noteDone }}
          />
        </section>

        <section className="fam-panel" aria-labelledby="rp-planb-title">
          <div>
            <span className="rp-over">{all.planB.over}</span>
            <h2 id="rp-planb-title" className="fam-panel__title">
              {all.planB.title}
            </h2>
          </div>
          <p className="card__body rp-body">{all.planB.body}</p>
          <ul className="rp-routes">
            {all.planB.routes.map((route) => (
              <li key={route.name}>
                <strong>{route.name}</strong>
                <span className="fam-small fam-muted">{route.meta}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="rp-row">
        <WhoCanSee access={r.access} owner={owner} childId={childId} childName={name} locale={locale} />
        <PracticeCount count={r.practiceCount} locale={locale} template="grade_3_4" />
      </div>
    </div>
  );
}
