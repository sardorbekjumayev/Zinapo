import { notFound, redirect } from 'next/navigation';
import { getMessages, isLocale, fill, type Locale } from './i18n';
import { fetchMe, homeFor, type Me, type Workspace } from './me';

export interface WorkspaceContext {
  locale: Locale;
  me: Me;
  crumb: string;
}

const SEASON = '2026/27';

/**
 * The server-side half of the workspace check, run by each workspace layout.
 *
 * `middleware.ts` does the same test from the JWT claims so the person is not
 * bounced after a page render, but the middleware trusts a 15-minute-old
 * snapshot. This re-checks against `/api/me`, and the API re-checks again on
 * every data call — three layers, because the claim is the only one a client
 * could ever influence.
 *
 * Someone who does not hold the workspace is sent to one they do, not shown a
 * 403: being in the wrong place is a navigation mistake, not a refusal.
 */
export async function requireWorkspace(
  rawLocale: string,
  workspace: Workspace,
): Promise<WorkspaceContext> {
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale;

  const me = await fetchMe();
  if (!me) redirect(`/${locale}/sign-in?next=/${locale}/${workspace}`);

  if (!me.workspaces.includes(workspace)) {
    const home = homeFor(me);
    redirect(home ? `/${locale}/${home}` : `/${locale}/onboarding`);
  }

  const t = getMessages(locale);
  const crumb = fill(t.crumb[workspace], {
    name: me.person.fullName,
    season: SEASON,
    roles: (me.staff?.roles ?? []).map((role) => t.staffRole[role]).join(' · '),
  });

  return { locale, me, crumb };
}
