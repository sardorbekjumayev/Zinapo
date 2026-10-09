import { Icon, type IconName } from '@/components/shell/Icon';

/**
 * One calm full-stage message: not found, signed out, expired, empty, errors.
 * Server-safe (no hooks) so the page can render it before any JavaScript runs.
 */
export function KidState({
  tone = 'neutral',
  icon,
  title,
  body,
  children,
  alert = false,
}: {
  tone?: 'neutral' | 'warning' | 'danger';
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <section className="kd-card kd-state" role={alert ? 'alert' : undefined}>
      <span className={`kd-state__icon kd-state__icon--${tone}`}>
        <Icon name={icon} size={26} />
      </span>
      <h1 className="kd-state__title">{title}</h1>
      <p className="kd-state__body">{body}</p>
      {children && <div className="kd-state__actions">{children}</div>}
    </section>
  );
}
