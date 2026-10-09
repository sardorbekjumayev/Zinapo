import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { GroupPicker } from '@/components/educator/practice/GroupPicker';
import { ModeBanner } from '@/components/educator/practice/ModeBanner';
import { NotApproved } from '@/components/educator/practice/NotApproved';
import { PracticeBuilder } from '@/components/educator/practice/PracticeBuilder';
import type { BuilderSource } from '@/components/educator/practice/SourceSwitch';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { GroupList, GroupOverview, PracticeTopic } from '@/lib/educator-types';
import { isLocale } from '@/lib/i18n';
import { practiceMessages } from '@/messages/practice';

export const dynamic = 'force-dynamic';

type Search = Promise<{ source?: string; code?: string; group?: string; wave?: string }>;

const enc = encodeURIComponent;

/**
 * `/educator/practice/new` — design/09, task.md § 8.4.6. The cabinet links
 * here with `?source=misconception&code=…&group=…&wave=…`. A set is always
 * built for one group: its grade decides the questions, its children are who
 * can get it.
 */
export default async function PracticeNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Search;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = practiceMessages(locale);
  const source: BuilderSource = sp.source === 'topic' ? 'topic' : 'misconception';
  const self = `/${locale}/educator/practice/new`;

  const groupsRes = await apiGet<GroupList>('/api/educator/groups');
  if (!groupsRes.ok) {
    if (groupsRes.status === 403) return <NotApproved locale={locale} m={m.common} />;
    return (
      <ErrorState
        title={m.list.errTitle}
        body={m.list.errBody}
        retryHref={`${self}?${new URLSearchParams(sp as Record<string, string>).toString()}`}
        retryLabel={m.common.retry}
      />
    );
  }
  const groups = groupsRes.data.groups;

  const back = (
    <Link href={`/${locale}/educator/practice`} className="pr-back">
      <Icon name="arrowLeft" size={16} />
      {m.builder.back}
    </Link>
  );

  let overview: GroupOverview | null = null;
  let groupMissing = false;
  if (sp.group) {
    const q = sp.wave ? `?waveId=${enc(sp.wave)}` : '';
    const res = await apiGet<GroupOverview>(`/api/educator/groups/${enc(sp.group)}/overview${q}`);
    if (res.ok) overview = res.data;
    else if (res.status === 404 || res.status === 400) groupMissing = true;
    else {
      return (
        <>
          <ModeBanner m={m.mode} />
          {back}
          <ErrorState
            title={m.builder.overviewError}
            body={m.list.errBody}
            retryHref={`${self}?${new URLSearchParams(sp as Record<string, string>).toString()}`}
            retryLabel={m.common.retry}
          />
        </>
      );
    }
  }

  if (!overview || overview.group.grade === null) {
    return (
      <>
        <ModeBanner m={m.mode} />
        {back}
        <GroupPicker
          locale={locale}
          m={m}
          source={source}
          groups={groups}
          notice={groupMissing ? m.builder.groupNotFound : null}
        />
      </>
    );
  }

  const grade = overview.group.grade;
  let topics: PracticeTopic[] | null = null;
  if (source === 'topic') {
    const res = await apiGet<PracticeTopic[]>(`/api/educator/practice/topics?grade=${grade}`);
    topics = res.ok ? res.data : null;
  }

  return (
    <>
      <ModeBanner m={m.mode} />
      {back}
      <PracticeBuilder
        // A new group or source is a new builder, not a stale one.
        key={`${overview.group.id}:${source}:${overview.wave?.id ?? ''}`}
        locale={locale}
        m={{ builder: m.builder, common: m.common }}
        source={source}
        group={{ id: overview.group.id, name: overview.group.name, grade }}
        wave={overview.wave ? { id: overview.wave.id, ordinal: overview.wave.ordinal } : null}
        took={overview.stats.took}
        mistakes={overview.misconceptions}
        topics={topics}
        groupChildren={overview.children.map((c) => ({ id: c.id, name: c.name }))}
        initialCode={sp.code ?? null}
      />
    </>
  );
}
