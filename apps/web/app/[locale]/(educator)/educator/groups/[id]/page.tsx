import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { GroupManage } from '@/components/educator/cabinet/GroupManage';
import { GroupProgress } from '@/components/educator/cabinet/GroupProgress';
import { MistakesPanel } from '@/components/educator/cabinet/MistakesPanel';
import { NotTakenPanel } from '@/components/educator/cabinet/NotTakenPanel';
import { ViewTabs } from '@/components/educator/cabinet/ViewTabs';
import { UUID, waveName } from '@/components/educator/cabinet/labels';
import { Icon } from '@/components/shell/Icon';
import { LiveRegion } from '@/components/staff/review/live';
import { apiGet } from '@/lib/api-server';
import type { GroupList, GroupOverview, VisibleChild } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, isLocale, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';

export const dynamic = 'force-dynamic';

/**
 * `/educator/groups/[id]` — design/08's group overview (task.md § 8.4.3–5).
 *
 * The educator never sees a percentile (task.md § 3, rule 1.9; note M6-a): the
 * design's "Current position" column and "+14 / −6" numbers are not built —
 * each child carries the API's progress category, in the API's order.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ wave?: string }>;
}) {
  const { locale, id } = await params;
  const { wave: waveParam } = await searchParams;
  if (!isLocale(locale)) notFound();
  const m = educatorMessages(locale);
  const g = m.group;
  const enc = encodeURIComponent(id);
  const waveId = waveParam && UUID.test(waveParam) ? waveParam : undefined;
  const self = `/${locale}/educator/groups/${id}${waveId ? `?wave=${waveId}` : ''}`;

  const [ovRes, listRes, kidsRes] = await Promise.all([
    apiGet<GroupOverview>(`/api/educator/groups/${enc}/overview${waveId ? `?waveId=${waveId}` : ''}`),
    apiGet<GroupList>('/api/educator/groups'),
    apiGet<VisibleChild[]>('/api/educator/children'),
  ]);

  if (!ovRes.ok) {
    if (ovRes.status === 403) redirect(`/${locale}/educator`);
    if (ovRes.status === 404 || ovRes.status === 400) return <GroupNotFound locale={locale} />;
    return <ErrorState title={g.loadErrorTitle} body={g.loadErrorBody} retryHref={self} retryLabel={m.common.retry} />;
  }

  const ov = ovRes.data;
  const wave = ov.wave;
  const ungrouped = listRes.ok ? listRes.data.ungroupedCount : 0;
  const visible = kidsRes.ok ? kidsRes.data : [];
  const members = visible.filter((c) => c.groups.some((x) => x.id === ov.group.id));
  const candidates = visible.filter(
    (c) => !c.groups.some((x) => x.id === ov.group.id) && (ov.group.grade === null || c.grade === ov.group.grade),
  );
  // Ungrouped children first: placing them is why this list is usually opened.
  candidates.sort((a, b) => Number(a.groups.length > 0) - Number(b.groups.length > 0));

  const subtitle = !wave
    ? g.subNone
    : fill(wave.state === 'open' ? g.subOpen : wave.state === 'closed' ? g.subClosed : g.subUpcoming, {
        n: wave.ordinal,
        date: formatDate(wave.state === 'upcoming' ? wave.opensAt : wave.closesAt, locale),
        took: ov.stats.took,
        total: ov.stats.total,
      });
  // Only waves with something to show; the selected one always stays listed.
  const pickable = ov.waves.filter((w) => w.state !== 'upcoming' || w.id === wave?.id);
  const isEmpty = ov.stats.total === 0 && ov.children.length === 0 && ov.notTaken.length === 0;

  return (
    <LiveRegion>
      <header className="ed-head">
        <div className="ed-head__text">
          <span className="chip chip--monitoring ed-selfStart">
            {wave ? fill(g.kicker, { n: wave.ordinal }) : g.kickerNone}
          </span>
          <h1 className="pageHead__title">{ov.group.name}</h1>
          <p className="card__body">{subtitle}</p>
        </div>
        <ViewTabs locale={locale} current="pupils" pupilsHref={`/${locale}/educator/groups/${id}`} />
      </header>

      {pickable.length > 1 && (
        <nav className="ed-waves" aria-label={g.waveLabel}>
          {pickable.map((w) => (
            <Link
              key={w.id}
              href={`/${locale}/educator/groups/${id}?wave=${w.id}`}
              className="ed-waves__link"
              aria-current={w.id === wave?.id ? 'page' : undefined}
            >
              {waveName(m, w.ordinal)}
              <span className="ed-waves__state">{w.state === 'open' ? g.waveOpen : w.state === 'closed' ? g.waveClosed : ''}</span>
            </Link>
          ))}
        </nav>
      )}

      {ungrouped > 0 && (
        <p className="fam-note fam-note--brand">
          <Icon name="users" size={18} />
          <span>
            {fill(g.ungrouped, { n: ungrouped })}{' '}
            <a href="#manage" className="ed-link">
              {m.manage.addTitle}
            </a>
          </span>
        </p>
      )}

      {isEmpty ? (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="users" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h2 className="state__title">{g.emptyTitle}</h2>
            <p className="card__body ed-measure">{g.emptyBody}</p>
          </div>
        </section>
      ) : (
        <>
          <div className="tiles ed-tiles">
            <Tile
              label={wave ? fill(g.tTook, { n: wave.ordinal }) : g.tTookNone}
              value={`${ov.stats.took} / ${ov.stats.total}`}
              sub={
                ov.stats.total - ov.stats.took > 0
                  ? fill(g.tTookSub, { n: ov.stats.total - ov.stats.took })
                  : g.tTookSubDone
              }
            />
            <Tile label={g.tUp} value={ov.stats.up} sub={g.tUpSub} tone="up" />
            <Tile label={g.tFlat} value={ov.stats.flat} sub={g.tFlatSub} />
            <Tile label={g.tLook} value={ov.stats.look} sub={g.tLookSub} tone="look" />
          </div>

          <div className="fam-grid ed-grid">
            <section className="fam-panel" aria-labelledby="ed-gain-title">
              <div>
                <h2 id="ed-gain-title" className="fam-panel__title">
                  {g.gainTitle}
                </h2>
                <p className="fam-panel__sub">{g.gainSub}</p>
              </div>
              <GroupProgress locale={locale} rows={ov.children} waveOrdinal={wave?.ordinal ?? null} />
              <p className="fam-caption">
                <Icon name="info" size={14} />
                <span>
                  {ov.progressWaves.from !== null && ov.progressWaves.to !== null
                    ? fill(g.noteCompare, { from: ov.progressWaves.from, to: ov.progressWaves.to })
                    : g.noteNoCompare}{' '}
                  {g.notePositions}
                  {ov.ownChildExcluded && ` ${g.noteOwn}`}
                </span>
              </p>
            </section>

            <div className="fam-col">
              <section className="fam-panel" aria-labelledby="ed-mis-title">
                <div>
                  <h2 id="ed-mis-title" className="fam-panel__title">
                    {g.mTitle}
                  </h2>
                  <p className="fam-panel__sub">{g.mSub}</p>
                </div>
                <MistakesPanel
                  locale={locale}
                  items={ov.misconceptions}
                  took={ov.stats.took}
                  groupId={ov.group.id}
                  waveId={wave?.id ?? null}
                />
              </section>

              {wave && (
                <section className="fam-panel" aria-labelledby="ed-miss-title">
                  <div>
                    <h2 id="ed-miss-title" className="fam-panel__title">
                      {fill(g.missTitle, { n: wave.ordinal })}
                    </h2>
                    <p className="fam-panel__sub">
                      {fill(
                        wave.state === 'open' ? g.missSubOpen : wave.state === 'closed' ? g.missSubClosed : g.missSubUpcoming,
                        { n: wave.ordinal, date: formatDate(wave.closesAt, locale, false) },
                      )}
                    </p>
                  </div>
                  {ov.notTaken.length === 0 ? (
                    <p className="fam-note fam-note--ok">
                      <Icon name="check" size={18} />
                      {fill(g.missNone, { n: wave.ordinal })}
                    </p>
                  ) : (
                    <NotTakenPanel locale={locale} groupId={ov.group.id} rows={ov.notTaken} canRemind={ov.canRemind} />
                  )}
                </section>
              )}
            </div>
          </div>
        </>
      )}

      <GroupManage locale={locale} group={ov.group} members={members} candidates={candidates} />
    </LiveRegion>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone?: 'up' | 'look' }) {
  return (
    <div className="tile">
      <span className="ed-tile__label">{label}</span>
      <span className={tone ? `tile__value ed-tile__value--${tone}` : 'tile__value'}>{value}</span>
      <span className="fam-muted fam-small">{sub}</span>
    </div>
  );
}

function GroupNotFound({ locale }: { locale: Locale }) {
  const m = educatorMessages(locale);
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="users" size={26} />
      </span>
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <h1 className="state__title">{m.common.notFoundGroup}</h1>
      </div>
      <Link href={`/${locale}/educator`} className="fam-btn fam-btn--primary">
        <Icon name="arrowLeft" size={18} />
        {m.common.toCabinet}
      </Link>
    </section>
  );
}
