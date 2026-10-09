import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { StateBlock } from '@/components/family/access/parts';
import { StageTag, outcomeText, stageOf } from '@/components/family/trust/shared';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import { formatDate } from '@/lib/format';
import { fill, isLocale } from '@/lib/i18n';
import type { FamilyDispute } from '@/lib/trust-types';
import { disputesMessages } from '@/messages/disputes';
import { familyMessages } from '@/messages/family';

export const dynamic = 'force-dynamic';

/**
 * `/family/disputes` — every ownership dispute this person is a party to,
 * as the claimant or as the (current or former) owner (task.md § 8.2, M8-d).
 * The (family) layout lets a claimant who owns no child open it.
 */
export default async function DisputesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = disputesMessages(locale);
  const f = familyMessages(locale);
  const self = `/${locale}/family/disputes`;

  const res = await apiGet<FamilyDispute[]>('/api/family/disputes');
  if (!res.ok) {
    return <ErrorState title={m.list.errTitle} body={m.list.errBody} retryHref={self} retryLabel={f.common.retry} />;
  }
  if (res.data.length === 0) {
    return (
      <StateBlock icon="child" title={m.list.emptyTitle} body={m.list.emptyBody} href={`/${locale}/family`} cta={m.list.emptyCta} />
    );
  }

  return (
    <>
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="card__kicker">{m.list.kicker}</span>
          <h1 className="pageHead__title">{m.list.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.list.sub}
          </p>
        </div>
      </div>

      <ul className="dp-list">
        {res.data.map((d) => {
          const decided = stageOf(d.status) === 'decided';
          return (
            <li key={d.id}>
              <Link href={`${self}/${encodeURIComponent(d.id)}`} className="dp-row lift">
                <span className="dp-row__icon" aria-hidden="true">
                  <Icon name={d.role === 'claimant' ? 'flag' : 'shield'} size={22} />
                </span>
                <span className="dp-row__body">
                  <span className="dp-row__top">
                    <span className="mono dp-ref">{d.reference}</span>
                    <span className={d.role === 'claimant' ? 'fam-tag fam-tag--blue' : 'fam-tag fam-tag--teal'}>
                      {d.role === 'claimant' ? m.list.roleClaimant : m.list.roleOwner}
                    </span>
                    <StageTag status={d.status} m={m} />
                  </span>
                  <span className="dp-row__name">{d.childName}</span>
                  <span className={decided ? 'dp-row__outcome dp-row__outcome--done' : 'dp-row__outcome'}>
                    {outcomeText(d, m)}
                  </span>
                  <span className="dp-row__meta">
                    {fill(m.list.opened, { date: formatDate(d.openedAt, locale) })}
                    {d.resolvedAt && <> · {fill(m.list.decided, { date: formatDate(d.resolvedAt, locale) })}</>}
                  </span>
                </span>
                <span className="dp-row__cta">
                  <span className="dp-hideSm">{m.list.open}</span>
                  <Icon name="arrowRight" size={18} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
