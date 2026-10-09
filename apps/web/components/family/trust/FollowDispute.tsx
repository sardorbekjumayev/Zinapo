import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import { disputesMessages } from '@/messages/disputes';

/** The add-child wizard's "dispute opened" state → the case page (M8). */
export function FollowDispute({ caseId, locale }: { caseId: string; locale: Locale }) {
  const m = disputesMessages(locale);
  return (
    <Link href={`/${locale}/family/disputes/${encodeURIComponent(caseId)}`} className="dp-entry lift">
      <span className="dp-entry__icon" aria-hidden="true">
        <Icon name="shield" size={22} />
      </span>
      <span className="dp-entry__body">
        <span className="dp-entry__title">{m.entry.follow}</span>
        <span className="dp-entry__text">{m.entry.followBody}</span>
      </span>
      <span className="dp-entry__cta">
        <Icon name="arrowRight" size={18} />
      </span>
    </Link>
  );
}
