import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { LiveRegion } from '@/components/staff/bank/live';
import { MisconceptionsPanel } from '@/components/staff/bank/MisconceptionsPanel';
import { NoAccess } from '@/components/staff/bank/parts';
import { SkillsPanel } from '@/components/staff/bank/SkillsPanel';
import { TopicsPanel } from '@/components/staff/bank/TopicsPanel';
import { apiGet } from '@/lib/api-server';
import type { Taxonomy } from '@/lib/bank-types';
import { isLocale } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { bankMessages } from '@/messages/bank';

export const dynamic = 'force-dynamic';

const TABS = ['topics', 'skills', 'misconceptions'] as const;
type Tab = (typeof TABS)[number];

/**
 * `/staff/taxonomy` — task.md § 12 M3 "Taxonomy CRUD: topics (3 clusters),
 * skills (grades 0–2), misconceptions". No board of its own; built from the
 * design/11 parts. Everyone with an item role reads it; only `taxonomy.manage`
 * (the bank editor, M3-d) sees the edit controls — the API checks again.
 */
export default async function TaxonomyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { me } = await requireWorkspace(locale, 'staff');
  const m = bankMessages(locale);
  const t = m.tax;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'topics';
  const base = `/${locale}/staff/taxonomy`;

  const res = await apiGet<Taxonomy>('/api/staff/taxonomy');
  if (!res.ok && res.status === 403) return <NoAccess m={m} locale={locale} />;
  if (!res.ok) {
    return (
      <ErrorState
        title={m.error.title}
        body={m.error.body}
        retryHref={`${base}?tab=${tab}`}
        retryLabel={m.common.retry}
      />
    );
  }

  const { topics, skills, misconceptions } = res.data;
  const copy = { m, locale, canManage: hasPermission(me, 'taxonomy.manage') };
  const label: Record<Tab, [string, number]> = {
    topics: [t.tabTopics, topics.length],
    skills: [t.tabSkills, skills.length],
    misconceptions: [t.tabMis, misconceptions.length],
  };

  return (
    <LiveRegion>
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px', flex: 1, minWidth: 0 }}>
          <h1 className="pageHead__title">{t.title}</h1>
          <p className="card__body" style={{ maxWidth: '72ch' }}>
            {t.subtitle}
          </p>
        </div>
      </div>

      <p className="fam-note fam-note--brand">
        <Icon name="lock" size={18} />
        <span>
          {t.rule}
          {!copy.canManage && <> {t.readOnly}</>}
        </span>
      </p>

      <nav className="bk-tabs" aria-label={t.tabsLabel}>
        {TABS.map((key) => (
          <Link
            key={key}
            href={`${base}?tab=${key}`}
            className="bk-tab"
            aria-current={tab === key ? 'page' : undefined}
            scroll={false}
          >
            {label[key][0]}
            <span className="bk-tab__n">{label[key][1]}</span>
          </Link>
        ))}
      </nav>

      {tab === 'topics' && <TopicsPanel topics={topics} copy={copy} />}
      {tab === 'skills' && <SkillsPanel skills={skills} topics={topics} copy={copy} />}
      {tab === 'misconceptions' && (
        <MisconceptionsPanel misconceptions={misconceptions} topics={topics} copy={copy} />
      )}
    </LiveRegion>
  );
}
