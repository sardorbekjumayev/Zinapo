import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import type { RailGroup } from '@/components/shell/nav-items';
import { apiGet } from '@/lib/api-server';
import type { GroupList } from '@/lib/educator-types';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/** The tutor and teacher workspace (task.md § 7, `(educator)`). */
export default async function EducatorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await requireWorkspace(locale, 'educator');

  // design/08: the rail lists each group. Only an APPROVED educator has any
  // (the API answers 403 before that); a failure costs only the list.
  let groups: RailGroup[] = [];
  if (ctx.me.educator?.status === 'approved') {
    const list = await apiGet<GroupList>('/api/educator/groups');
    if (list.ok) groups = list.data.groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
  }

  return (
    <WorkspaceShell locale={ctx.locale} me={ctx.me} workspace="educator" crumb={ctx.crumb} teachingGroups={groups}>
      {children}
    </WorkspaceShell>
  );
}
