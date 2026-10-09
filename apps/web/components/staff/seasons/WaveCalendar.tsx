'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { sessionApi } from '@/lib/session-api';
import type { StaffWave, WaveForm } from '@/lib/session-types';
import type { SeasonsMessages } from '@/messages/seasons';
import { formatWhen, GRADES, ORDINALS } from './shared';
import { useSeasonAction } from './useSeasonAction';
import { WaveDialog, type WaveTarget } from './WaveDialog';

/**
 * Grades 0–4 × waves 1–8 of one season (task.md § 8.5: "waves per grade with
 * windows, 8 per season"). Each cell is a window, its form and its progress;
 * an empty cell is the way to set that wave.
 */
export function WaveCalendar({
  seasonId,
  waves,
  formsByGrade,
  locale,
  m,
}: {
  seasonId: string;
  waves: StaffWave[];
  formsByGrade: Record<number, WaveForm[]>;
  locale: Locale;
  m: SeasonsMessages;
}) {
  const [target, setTarget] = useState<WaveTarget | null>(null);
  const gradeName = (g: number) => m.cal.grade[String(g) as keyof SeasonsMessages['cal']['grade']];
  const byKey = new Map(waves.map((w) => [`${w.grade}:${w.ordinal}`, w]));

  return (
    <>
      <div className="ss-cal">
        {GRADES.map((g) => {
          const set = waves.filter((w) => w.grade === g).length;
          return (
            <section key={g} className="ss-grade" aria-labelledby={`ss-g${g}`}>
              <div className="ss-grade__head">
                <h3 id={`ss-g${g}`} className="ss-grade__title">
                  {gradeName(g)}
                </h3>
                <span className="fam-small fam-muted">{fill(m.cal.gradeCountFmt, { n: set })}</span>
              </div>
              <ol className="ss-waves">
                {ORDINALS.map((n) => {
                  const w = byKey.get(`${g}:${n}`) ?? null;
                  return (
                    <li key={n} className="ss-cell" data-state={w?.state ?? 'empty'}>
                      {w ? (
                        <WaveCell
                          wave={w}
                          gradeName={gradeName(g)}
                          locale={locale}
                          m={m}
                          onEdit={() => setTarget({ grade: g, ordinal: n, wave: w })}
                        />
                      ) : (
                        <>
                          <span className="ss-cell__n">{fill(m.cal.wave, { n })}</span>
                          <span className="fam-small fam-muted">{m.cal.notSet}</span>
                          <button
                            type="button"
                            className="ss-cell__set"
                            aria-label={fill(m.cal.setAria, { n, grade: gradeName(g) })}
                            onClick={() => setTarget({ grade: g, ordinal: n, wave: null })}
                          >
                            <Icon name="plus" size={16} />
                            {fill(m.cal.set, { n })}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {target && (
        <WaveDialog
          key={`${target.grade}:${target.ordinal}`}
          target={target}
          seasonId={seasonId}
          forms={formsByGrade[target.grade] ?? []}
          gradeName={gradeName(target.grade)}
          m={m}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

function WaveCell({
  wave: w,
  gradeName,
  locale,
  m,
  onEdit,
}: {
  wave: StaffWave;
  gradeName: string;
  locale: Locale;
  m: SeasonsMessages;
  onEdit: () => void;
}) {
  const pct = w.eligible > 0 ? Math.min(100, (w.submitted / w.eligible) * 100) : 0;
  return (
    <>
      <div className="ss-cell__head">
        <span className="ss-cell__n">{fill(m.cal.wave, { n: w.ordinal })}</span>
        <span className={`chip ss-chip--${w.state}`}>{m.cal.state[w.state]}</span>
      </div>
      <span className="ss-cell__dates">
        <span>{formatWhen(w.opensAt, locale)}</span>
        <span aria-hidden="true">↓</span>
        <span>{formatWhen(w.closesAt, locale)}</span>
      </span>
      {w.formLabel ? (
        <span className="ss-cell__form" title={w.formLabel}>
          <Icon name="file" size={14} />
          {w.formLabel}
        </span>
      ) : (
        <span className="ss-cell__noForm">
          <Icon name="alert" size={14} />
          {m.cal.noForm}
        </span>
      )}
      {w.state !== 'upcoming' && (
        <span className="ss-cell__progress">
          <span className="fam-small">{fill(m.cal.progressFmt, { s: w.submitted, e: w.eligible })}</span>
          <span className="ss-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          {w.inProgress > 0 && (
            <span className="fam-small fam-muted">{fill(m.cal.inProgressFmt, { n: w.inProgress })}</span>
          )}
        </span>
      )}
      {w.state === 'closed' ? (
        <span className="fam-small fam-muted ss-cell__foot">
          <Icon name="lock" size={14} /> {m.cal.readOnly}
        </span>
      ) : (
        <div className="ss-cell__foot">
          <button
            type="button"
            className="fam-btn fam-btn--sm"
            aria-label={fill(m.cal.editAria, { n: w.ordinal, grade: gradeName })}
            onClick={onEdit}
          >
            <Icon name={w.state === 'open' ? 'clock' : 'edit'} size={16} />
            {w.state === 'open' ? m.cal.extend : m.cal.edit}
          </button>
          {w.state === 'open' && <RemindButton wave={w} gradeName={gradeName} m={m} />}
        </div>
      )}
    </>
  );
}

/** § 10: reminders go to owners only, at most one per child per day — the API enforces both. */
function RemindButton({ wave, gradeName, m }: { wave: StaffWave; gradeName: string; m: SeasonsMessages }) {
  const act = useSeasonAction(m);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ eligible: number; queued: number; throttled: number } | null>(null);

  async function send() {
    const r = await act.run(
      () => sessionApi.remind(wave.id),
      (x) => fill(m.remind.announceFmt, { n: wave.ordinal, queued: x.queued, throttled: x.throttled }),
    );
    if (r) {
      setResult(r);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="fam-btn fam-btn--sm"
        title={m.remind.btnLong}
        onClick={() => {
          act.setError(null);
          setOpen(true);
        }}
      >
        <Icon name="bell" size={16} />
        {m.remind.btn}
      </button>
      <span role="status" className="ss-cell__result fam-small">
        {result && fill(m.remind.doneFmt, result)}
      </span>
      <ConfirmDialog
        open={open}
        danger={false}
        icon="bell"
        title={fill(m.remind.title, { n: wave.ordinal, grade: gradeName })}
        body={m.remind.body}
        list={m.remind.list}
        confirmLabel={m.remind.confirm}
        cancelLabel={m.remind.cancel}
        busy={act.busy}
        error={act.error}
        onConfirm={send}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
