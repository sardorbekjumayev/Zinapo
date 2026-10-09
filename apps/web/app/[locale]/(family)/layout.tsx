import { headers } from 'next/headers';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import type { RailChild } from '@/components/shell/nav-items';
import { apiGet } from '@/lib/api-server';
import { childDisplayName } from '@/lib/format';
import type { ChildSummary } from '@/lib/family-types';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/** The parent workspace (task.md § 7, `(family)`). */
export default async function FamilyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Onboarding's "add my child" is the one family page a person with no
  // workspace may open (task.md § 2.2). `x-zn-path` comes from middleware.ts.
  const path = (await headers()).get('x-zn-path') ?? '';
  const addChild = /\/family\/children\/new\/?$/.test(path);
  // M8: a claimant in an ownership dispute may own no child at all — their
  // dispute page must still open.
  const disputes = /\/family\/disputes(\/[^/]+)?\/?$/.test(path);
  const ctx = await requireWorkspace(locale, 'family', { allowNoWorkspace: addChild || disputes });

  // The rail lists each child. A failure here only costs the list — the rail
  // falls back to a single link and the page still renders.
  const list = await apiGet<ChildSummary[]>('/api/family/children');
  const kids: RailChild[] = list.ok
    ? list.data.map((c) => ({ id: c.id, name: childDisplayName(c), grade: c.grade }))
    : [];

  return (
    <WorkspaceShell
      locale={ctx.locale}
      me={ctx.me}
      workspace="family"
      crumb={ctx.crumb}
      kids={kids}
    >
      {children}
    </WorkspaceShell>
  );
}
