import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { BankFilterBar } from '@/components/staff/bank/BankFilterBar';
import { BankOverviewPanel } from '@/components/staff/bank/BankOverviewPanel';
import { ItemTable } from '@/components/staff/bank/ItemTable';
import { LiveRegion } from '@/components/staff/bank/live';
import { BankState, NoAccess } from '@/components/staff/bank/parts';
import { PER_PAGE, anyFilter, parseFilters, toQuery } from '@/components/staff/bank/filters';
import { apiGet } from '@/lib/api-server';
import type { ItemList } from '@/lib/bank-types';
import { fill, isLocale } from '@/lib/i18n';
import { hasPermission, hasStaffRole } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { bankMessages } from '@/messages/bank';

export const dynamic = 'force-dynamic';

/**
 * `/staff/items` — design/11, the item bank list (task.md § 8.5, § 12 M3).
 * Reviewers and the bank editor see the whole bank with the season tiles; an
 * author gets only their own items (`overview: null`) as "My items".
 */
export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { me } = await requireWorkspace(locale, 'staff');
  const m = bankMessages(locale);
  const base = `/${locale}/staff/items`;
  const f = parseFilters(await searchParams);
  const query = toQuery({ ...f, page: f.page ?? '1' }).replace('?', '&');

  const res = await apiGet<ItemList>(`/api/staff/items?perPage=${PER_PAGE}${query}`);
  if (!res.ok && res.status === 403) return <NoAccess m={m} locale={locale} />;
  if (!res.ok) {
    return (
      <ErrorState
        title={m.error.title}
        body={m.error.body}
        retryHref={base + toQuery(f)}
        retryLabel={m.common.retry}
      />
    );
  }

  const { items, total, page, perPage, overview } = res.data;
  const canWrite = hasStaffRole(me, 'item_author', 'bank_editor');
  const filtered = anyFilter(f);
  const newHref = `/${locale}/staff/items/new`;
  const mine = overview === null;

  const subtitle = mine
    ? m.list.subtitleMine
    : overview.season
      ? fill(m.list.subtitle, {
          season: overview.season.code,
          written: overview.totals.written,
          approved: overview.totals.approved,
        })
      : m.list.subtitleNoSeason;

  // "Write the first item" only when nothing is filtered; a filter (or a page
  // past the end) with no rows gets "clear filters" instead.
  const emptyBank = total === 0 && !filtered;

  return (
    <LiveRegion>
      <div className="pageHead bk-head">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px', flex: 1, minWidth: 0 }}>
          <h1 className="pageHead__title">{mine ? m.list.titleMine : m.list.title}</h1>
          <p className="card__body" style={{ maxWidth: '78ch' }}>
            {subtitle}
          </p>
        </div>
        <div className="fam-inline">
          <Link href={`/${locale}/staff/taxonomy`} className="fam-btn fam-btn--quiet">
            {m.list.taxonomyLink}
          </Link>
          {canWrite && (
            <Link href={newHref} className="fam-btn fam-btn--primary">
              <Icon name="plus" size={18} />
              {m.list.newItem}
            </Link>
          )}
        </div>
      </div>

      {overview && (
        <BankOverviewPanel overview={overview} m={m} canEditTargets={hasPermission(me, 'item.approve')} />
      )}

      {emptyBank ? (
        <BankState
          as="h2"
          title={m.empty.bankTitle}
          body={mine ? m.empty.mineBody : m.empty.bankBody}
          href={canWrite ? newHref : undefined}
          cta={m.empty.cta}
        />
      ) : (
        <section className="fam-panel bk-list" aria-label={m.table.label}>
          <BankFilterBar base={base} f={f} m={m} />
          {items.length === 0 ? (
            <div className="bk-noRows" role="status">
              <span className="state__icon state__icon--empty">
                <Icon name="inbox" size={26} />
              </span>
              <h2 className="fam-panel__title">{m.empty.title}</h2>
              <p className="card__body" style={{ maxWidth: '62ch' }}>
                {m.empty.body}
              </p>
              <Link href={base} className="fam-btn fam-btn--primary">
                {m.filters.clear}
              </Link>
            </div>
          ) : (
            <ItemTable
              rows={items}
              total={total}
              page={page}
              perPage={perPage}
              showAuthor={!mine}
              filtered={filtered}
              base={base}
              f={f}
              locale={locale}
              m={m}
            />
          )}
        </section>
      )}
    </LiveRegion>
  );
}
