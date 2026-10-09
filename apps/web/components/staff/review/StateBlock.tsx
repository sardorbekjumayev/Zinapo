import Link from 'next/link';
import { Icon, type IconName } from '@/components/shell/Icon';

/**
 * Empty, no-access and not-found states for the staff bank screens
 * (task.md § 7.1: "why it's empty plus the next action").
 */
export function StateBlock({
  icon = 'inbox',
  tone = 'empty',
  title,
  body,
  links = [],
}: {
  icon?: IconName;
  tone?: 'empty' | 'error';
  title: string;
  body: string;
  links?: { href: string; label: string; primary?: boolean }[];
}) {
  return (
    <section className="state">
      <span className={`state__icon state__icon--${tone}`}>
        <Icon name={icon} size={26} />
      </span>
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <h2 className="state__title">{title}</h2>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
      </div>
      {links.length > 0 && (
        <div className="fam-inline" style={{ '--gap': '12px' } as React.CSSProperties}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={l.primary ? 'fam-btn fam-btn--primary' : 'fam-btn'}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
