import Link from 'next/link';
import { Avatar } from '@/components/family/Avatar';
import { Icon } from '@/components/shell/Icon';
import { childDisplayName } from '@/lib/format';
import type { ChildSummary } from '@/lib/family-types';
import { fill, type Locale } from '@/lib/i18n';
import { familyMessages } from '@/messages/family';
import { homeMessages } from '@/messages/home';
import { schoolLine } from './labels';

/** One child on the family home: who, where, and how I relate to them. */
export function ChildCard({ child, locale }: { child: ChildSummary; locale: Locale }) {
  const fm = familyMessages(locale);
  const m = homeMessages(locale).home;
  const owner = child.via === 'owner';
  const name = childDisplayName(child);

  return (
    <Link href={`/${locale}/family/children/${child.id}`} className="fp-kid lift">
      <span className="fp-kid__head">
        <Avatar name={name} tone={owner ? 'brand' : 'blue'} size="lg" />
        <span className="fp-kid__who">
          <span className="fp-kid__name">{name}</span>
          {child.grade !== null && (
            <span className="fam-muted fam-small">{fm.grade[String(child.grade) as keyof typeof fm.grade]}</span>
          )}
        </span>
      </span>

      <span className="fp-kid__meta">
        <Icon name="pin" size={16} />
        {schoolLine(child, locale, m.schoolNotListed)}
      </span>

      <span className="fam-inline">
        <span className={owner ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>
          {owner ? fm.role.owner : fm.role.co_guardian}
        </span>
        {child.deletionRequested && (
          <span className="fam-tag fam-tag--danger">{fm.common.deletionPending}</span>
        )}
      </span>
      {!owner && child.ownerName && (
        <span className="fam-muted fam-small">{fill(m.ownerLine, { name: child.ownerName })}</span>
      )}

      <span className="fp-kid__foot">
        {m.open}
        <Icon name="arrowRight" size={16} />
      </span>
    </Link>
  );
}
