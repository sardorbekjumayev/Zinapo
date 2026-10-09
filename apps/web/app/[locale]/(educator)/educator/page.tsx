import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { EmptyCabinet } from '@/components/educator/cabinet/EmptyCabinet';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { GroupList } from '@/lib/educator-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { educatorMessages } from '@/messages/educator';

export const dynamic = 'force-dynamic';

/**
 * `/educator` — the tutor's home. With a group it IS the first group
 * (design/08); without one, the empty state and "Create a group".
 *
 * task.md § 2.2: an educator whose application is still `applied` sees
 * `/educator/pending` instead. That check lives here rather than in the layout
 * so the pending screen itself can keep the educator chrome.
 */
export default async function EducatorHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'educator');
  if (me.educator?.status === 'applied') redirect(`/${locale}/educator/pending`);

  const m = educatorMessages(locale);
  const res = await apiGet<GroupList>('/api/educator/groups');

  if (!res.ok) {
    // 403: rejected or suspended — the API closes the cabinet; say so instead of "try again".
    if (res.status === 403) {
      return (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="lock" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="state__title">{m.home.inactiveTitle}</h1>
            <p className="card__body ed-measure">{m.home.inactiveBody}</p>
          </div>
          <Link href={`/${locale}/educator/pending`} className="fam-btn fam-btn--primary">
            {m.home.inactiveCta}
          </Link>
        </section>
      );
    }
    return (
      <ErrorState
        title={m.home.loadErrorTitle}
        body={m.home.loadErrorBody}
        retryHref={`/${locale}/educator`}
        retryLabel={m.common.retry}
      />
    );
  }

  const first = res.data.groups[0];
  if (first) redirect(`/${locale}/educator/groups/${first.id}`);

  return <EmptyCabinet locale={locale} ungrouped={res.data.ungroupedCount} />;
}
