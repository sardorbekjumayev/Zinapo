import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import type { StageKind, StageState } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';
import { byStageOrder, STATE_CHIP, whenLine } from './util';

/**
 * design/07's four-step season strip, from the stages that exist. The public
 * landing shows the same strip, so it takes only what both API shapes share.
 */
export function StageTimeline({
  stages,
  isRanked,
  locale,
  t,
  label,
}: {
  stages: { kind: StageKind; opensAt: string; closesAt: string; state: StageState }[];
  isRanked: boolean;
  locale: Locale;
  t: OlympiadMessages;
  label: string;
}) {
  return (
    <ol className="ol-timeline" aria-label={label}>
      {byStageOrder(stages).map((s) => (
        <li key={s.kind} className={`ol-timeline__step ol-timeline__step--${s.state}`}>
          <div className="ol-timeline__mark">
            <span className="ol-timeline__dot" aria-hidden="true">
              {s.state === 'closed' && <Icon name="check" size={14} />}
            </span>
            <span className={STATE_CHIP[s.state]}>{t.stage.chip[s.state]}</span>
          </div>
          <h3 className="ol-timeline__name">{t.stage.name[s.kind]}</h3>
          <p className="ol-timeline__when">{whenLine(s, locale, t)}</p>
          {/* The kind descriptions talk about tickets and prizes — not true of the 0–2 marathon. */}
          {isRanked && <p className="ol-timeline__desc">{t.stage.desc[s.kind]}</p>}
        </li>
      ))}
    </ol>
  );
}
