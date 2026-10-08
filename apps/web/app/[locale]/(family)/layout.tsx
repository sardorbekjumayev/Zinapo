import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
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
  const ctx = await requireWorkspace(locale, 'family');

  return (
    <WorkspaceShell locale={ctx.locale} me={ctx.me} workspace="family" crumb={ctx.crumb}>
      {children}
    </WorkspaceShell>
  );
}
