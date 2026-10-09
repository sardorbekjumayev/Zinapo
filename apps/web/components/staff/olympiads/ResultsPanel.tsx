'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi } from '@/lib/olympiad-api';
import type { ComputeSummary, OlympiadDetail } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { formatWhen, STAGE_KINDS } from './shared';
import { useOlympiadAction } from './useOlympiadAction';

type Stage = OlympiadDetail['stages'][number];

/**
 * Results per stage (task.md § 8.5, `olympiad.results`): compute as often as
 * needed, then publish once — families are notified and the results become
 * permanent, so a published stage shows its date and no buttons.
 */
export function ResultsPanel({ o, locale, m }: { o: OlympiadDetail; locale: Locale; m: OlympiadsMessages }) {
  const stages = [...o.stages].sort((a, b) => STAGE_KINDS.indexOf(a.kind) - STAGE_KINDS.indexOf(b.kind));
  return (
    <section className="fam-panel" id="oa-results" aria-labelledby="oa-results-title">
      <div>
        <h2 id="oa-results-title" className="fam-panel__title">
          {m.results.title}
        </h2>
        <p className="fam-panel__sub">{m.results.sub}</p>
      </div>
      {stages.length === 0 ? (
        <p className="fam-note">
          <Icon name="gauge" size={18} />
          <span>{m.results.noStages}</span>
        </p>
      ) : (
        <ul className="oa-results">
          {stages.map((s) => (
            <StageResults key={s.id} olympiadId={o.id} stage={s} locale={locale} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StageResults({ olympiadId, stage, locale, m }: { olympiadId: string; stage: Stage; locale: Locale; m: OlympiadsMessages }) {
  const compute = useOlympiadAction(m);
  const publish = useOlympiadAction(m);
  const [summary, setSummary] = useState<ComputeSummary | null>(null);
  const [confirm, setConfirm] = useState(false);
  const name = m.stage[stage.kind];

  async function run() {
    const r = await compute.run(
      () => olympiadApi.computeResults(olympiadId, stage.id),
      () => fill(m.results.computed, { stage: name }),
    );
    if (r) setSummary(r);
  }

  async function doPublish() {
    const r = await publish.run(
      () => olympiadApi.publish(olympiadId, stage.id),
      (res) => fill(m.results.published, { n: res.notified }),
    );
    if (r) setConfirm(false);
  }

  const published = stage.resultsPublishedAt;
  const qualifiedLbl = stage.kind === 'autumn_online' ? m.results.sum.invited : m.results.sum.qualified;

  return (
    <li className="oa-result" data-published={published ? 'true' : 'false'}>
      <div className="oa-result__head">
        <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <h3 className="oa-stage__title">{name}</h3>
          <span className="fam-small fam-muted">
            {published
              ? fill(m.results.publishedFmt, { date: formatWhen(published, locale, true) })
              : stage.resultsComputedAt
                ? fill(m.results.computedFmt, { date: formatWhen(stage.resultsComputedAt, locale, true) })
                : m.results.notComputed}
          </span>
        </div>
        {published ? (
          <span className="fam-tag fam-tag--ok">
            <Icon name="lock" size={14} />
            {m.list.published}
          </span>
        ) : (
          <div className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
            <button type="button" className="fam-btn fam-btn--sm" onClick={run} disabled={compute.busy} aria-busy={compute.busy}>
              {compute.busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="gauge" size={16} />}
              {stage.resultsComputedAt ? m.results.recompute : m.results.compute}
            </button>
            {stage.resultsComputedAt && (
              <button
                type="button"
                className="fam-btn fam-btn--sm fam-btn--primary"
                onClick={() => {
                  publish.setError(null);
                  setConfirm(true);
                }}
              >
                <Icon name="mail" size={16} />
                {m.results.publish}
              </button>
            )}
          </div>
        )}
      </div>

      {compute.error && (
        <p className="fam-alert" role="alert">
          {compute.error}
        </p>
      )}

      {summary && !published && (
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties} aria-live="polite">
          <h4 className="oa-stage__sub">{m.results.summaryTitle}</h4>
          <dl className="oa-sum">
            {(
              [
                ['taken', m.results.sum.taken],
                ['certificates', m.results.sum.certificates],
                ['qualified', qualifiedLbl],
                ['flagged', m.results.sum.flagged],
                ['bonusEducators', m.results.sum.bonusEducators],
                ['cups', m.results.sum.cups],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="oa-sum__item">
                <dt>{label}</dt>
                <dd className="mono">{summary[k]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {!published && (
        <ConfirmDialog
          open={confirm}
          danger={false}
          icon="mail"
          title={fill(m.results.publishTitle, { stage: name })}
          body={m.results.publishBody}
          list={m.results.publishList}
          confirmLabel={m.results.publishConfirm}
          cancelLabel={m.results.cancel}
          busy={publish.busy}
          error={publish.error}
          onConfirm={doPublish}
          onClose={() => setConfirm(false)}
        />
      )}
    </li>
  );
}
