import { Icon } from '@/components/shell/Icon';
import type { WizardMessages } from '@/messages/wizard';

/** The three-step strip of design/02. `current` 3 means every step is done. */
export function Stepper({ t, current }: { t: WizardMessages; current: 1 | 2 | 3 }) {
  const steps = [
    [t.st1, t.st1s],
    [t.st2, t.st2s],
    [t.st3, t.st3s],
  ];
  return (
    <nav aria-label={t.stepsLabel} className="wz-steps">
      <ol className="wz-steps__list">
        {steps.map(([label, sub], i) => {
          const n = i + 1;
          const done = n < current || current === 3;
          const isCurrent = n === current && current !== 3;
          const dot = done ? 'wz-step__dot wz-step__dot--done' : isCurrent ? 'wz-step__dot wz-step__dot--cur' : 'wz-step__dot';
          return (
            <li
              key={label}
              className={isCurrent ? 'wz-step wz-step--cur' : 'wz-step'}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className={dot} aria-hidden="true">
                {done ? <Icon name="check" size={20} strokeWidth={2} /> : n}
              </span>
              <span className="wz-step__text">
                <span className="wz-step__label">
                  {label}
                  {done && <span className="visually-hidden"> — {t.stepDone}</span>}
                </span>
                <span className="wz-step__sub">{sub}</span>
              </span>
              {n < 3 && (
                <span
                  className={n < current ? 'wz-step__line wz-step__line--done' : 'wz-step__line'}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
