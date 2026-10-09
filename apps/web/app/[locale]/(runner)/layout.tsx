import { KidBar } from '@/components/kid/KidBar';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { getMessages } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { finalsMessages } from '@/messages/finals';

export const dynamic = 'force-dynamic';

/**
 * The offline runner's frame (note M7-a): full screen like kid mode — no staff
 * rail, nothing a child could tap into — but still the staff workspace, so a
 * signed-in proctor is checked here on the server before anything renders.
 */
export default async function RunnerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');

  if (!hasPermission(me, 'final.proctor')) {
    const m = finalsMessages(locale);
    return (
      <div className="kid kd-root">
        <KidBar brand={getMessages(locale).brand} />
        <main className="kid__stage kd-stage">
          <StateBlock
            icon="lock"
            tone="error"
            title={m.states.noAccessTitle}
            body={m.states.noAccessBody}
            links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
          />
        </main>
      </div>
    );
  }

  return <div className="kid kd-root fn-runner">{children}</div>;
}
