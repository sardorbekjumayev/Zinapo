import { Icon } from '@/components/shell/Icon';

/**
 * The only chrome in kid mode (design/05): brand, the mode chip, who and which
 * wave, the timer and Exit. No nav rail, no language picker, no theme toggle —
 * nothing a child could tap by accident mid-test.
 */
export function KidBar({
  brand,
  mode,
  modeLabel,
  who,
  timer,
  action,
}: {
  brand: string;
  mode?: 'monitoring' | 'practice';
  modeLabel?: string;
  who?: string;
  timer?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="kid__bar kd-bar">
      <span className="kd-bar__brand">
        <span className="ws__brandMark">
          <Icon name="logo" size={22} strokeWidth={2} />
        </span>
        <span className="ws__brandName">{brand}</span>
      </span>
      {mode && modeLabel && (
        <>
          <span className="kd-bar__rule" aria-hidden="true" />
          <span className={`chip chip--${mode} kd-bar__chip`}>{modeLabel}</span>
        </>
      )}
      <span className="kd-bar__who">{who}</span>
      {timer}
      {action}
    </header>
  );
}
