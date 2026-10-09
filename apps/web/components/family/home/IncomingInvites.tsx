import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import type { IncomingInvite } from '@/lib/family-types';
import { fill, type Locale } from '@/lib/i18n';
import { homeMessages } from '@/messages/home';

/**
 * Guardian invitations addressed to the signed-in phone (task.md § 8.2). Shown
 * on the family home and on onboarding — someone invited as a co-guardian has
 * no workspace yet, so onboarding is where they land first.
 */
export function IncomingInvites({
  invites,
  locale,
  title,
  sub,
}: {
  invites: IncomingInvite[];
  locale: Locale;
  title?: string;
  sub?: string;
}) {
  if (invites.length === 0) return null;
  const m = homeMessages(locale).invites;

  return (
    <section className="fam-panel" aria-labelledby="fp-invites-title">
      <div>
        <h2 id="fp-invites-title" className="fam-panel__title">
          {title ?? m.title}
        </h2>
        <p className="fam-panel__sub">{sub ?? m.sub}</p>
      </div>
      <ul className="fp-invites">
        {invites.map((inv) => (
          <li key={inv.code}>
            <Link href={`/${locale}/guardian-invite/${encodeURIComponent(inv.code)}`} className="fp-invite">
              <span className="fp-invite__icon" aria-hidden="true">
                <Icon name={inv.kind === 'ownership_transfer' ? 'shield' : 'users'} size={20} />
              </span>
              <span className="fp-invite__body">
                <span className="fp-invite__title">
                  {fill(inv.kind === 'ownership_transfer' ? m.ownership : m.coGuardian, {
                    inviter: inv.inviterName,
                    child: inv.childName,
                  })}
                </span>
                <span className="fam-caption">
                  <Icon name="clock" size={14} />
                  {fill(m.expires, { date: formatDate(inv.expiresAt, locale) })}
                </span>
              </span>
              <span className="fp-invite__cta">
                {m.open}
                <Icon name="arrowRight" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
