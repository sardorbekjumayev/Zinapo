import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
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

  return (
    <WorkspaceShell locale={ctx.locale} me={ctx.me} workspace="educator" crumb={ctx.crumb}>
      {children}
    </WorkspaceShell>
  );
}
