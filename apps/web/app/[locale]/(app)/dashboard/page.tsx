import { notFound, redirect } from 'next/navigation';
import { isLocale } from '@/lib/i18n';
import { fetchMe, homeFor } from '@/lib/me';

/** Reads the session on every request — never prerender this. */
export const dynamic = 'force-dynamic';

/**
 * The role router (task.md § 2.2).
 *
 * This page renders nothing in the normal case: it reads `/api/me` and
 * redirects. Keeping the decision on the server means a person never sees the
 * wrong workspace flash before being moved.
 *
 *   0 workspaces  → /onboarding
 *   1 workspace   → its home
 *   >1            → lastWorkspace's home, switcher in the header
 *
 * An educator with `status: 'applied'` is sent to /educator/pending by the
 * educator layout, not here — that is the educator workspace's own state.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const me = await fetchMe();

  // `middleware.ts` has already bounced anyone without a cookie, so reaching
  // here with no `me` means the token expired or the API is down. Either way
  // sign-in is the honest destination.
  if (!me) redirect(`/${locale}/sign-in?next=/${locale}/dashboard`);

  const home = homeFor(me);
  if (!home) redirect(`/${locale}/onboarding`);
  redirect(`/${locale}/${home}`);
}
