import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';

/**
 * design/08's "My pupils / My children" switch plus "Invite parents". Two
 * pages, not one toggled view: the own children are kept apart on purpose
 * (task.md § 8.4.7) and each view has its own URL.
 */
export function ViewTabs({ locale, current, pupilsHref }: { locale: Locale; current: 'pupils' | 'kids'; pupilsHref: string }) {
  const g = educatorMessages(locale).group;
  return (
    <div className="ed-headActions">
      <nav className="ed-seg" aria-label={g.viewLabel}>
        <Link href={pupilsHref} className="ed-seg__link" aria-current={current === 'pupils' ? 'page' : undefined}>
          {g.tabPupils}
        </Link>
        <Link
          href={`/${locale}/educator/my-children`}
          className="ed-seg__link"
          aria-current={current === 'kids' ? 'page' : undefined}
        >
          {g.tabKids}
        </Link>
      </nav>
      <Link href={`/${locale}/educator/invites`} className="fam-btn fam-btn--primary">
        <Icon name="plus" size={18} />
        {g.invite}
      </Link>
    </div>
  );
}
