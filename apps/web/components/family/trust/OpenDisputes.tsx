import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import { fill, type Locale } from '@/lib/i18n';
import type { FamilyDispute } from '@/lib/trust-types';
import { disputesMessages } from '@/messages/disputes';
import { stageOf } from './shared';

/**
 * "Open disputes: N" on onboarding and the family home (task.md § 12 M8): the
 * way back to a dispute for a claimant who owns no child. An extra — a failed
 * call, or nothing open, renders nothing.
 */
export async function OpenDisputes({ locale }: { locale: Locale }) {
  const res = await apiGet<FamilyDispute[]>('/api/family/disputes');
  if (!res.ok) return null;
  const open = res.data.filter((d) => stageOf(d.status) !== 'decided').length;
  if (open === 0) return null;
  const m = disputesMessages(locale);
  return (
    <Link href={`/${locale}/family/disputes`} className="dp-entry lift">
      <span className="dp-entry__icon" aria-hidden="true">
        <Icon name="shield" size={22} />
      </span>
      <span className="dp-entry__body">
        <span className="dp-entry__title">{fill(m.entry.title, { n: open })}</span>
        <span className="dp-entry__text">{m.entry.body}</span>
      </span>
      <span className="dp-entry__cta">
        <span className="dp-hideSm">{m.entry.cta}</span>
        <Icon name="arrowRight" size={18} />
      </span>
    </Link>
  );
}
