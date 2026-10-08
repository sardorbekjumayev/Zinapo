import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/** The staff console (task.md § 7, `(staff)`). The rail is role-aware.. */
export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await requireWorkspace(locale, 'staff');

  return (
    <WorkspaceShell locale={ctx.locale} me={ctx.me} workspace="staff" crumb={ctx.crumb}>
      {children}
    </WorkspaceShell>
  );
}
