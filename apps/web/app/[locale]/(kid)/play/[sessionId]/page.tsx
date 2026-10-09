import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KidBar } from '@/components/kid/KidBar';
import { KidPlayer } from '@/components/kid/KidPlayer';
import { KidState } from '@/components/kid/KidState';
import { UUID_RE } from '@/components/kid/util';
import { apiGet } from '@/lib/api-server';
import { getMessages, isLocale } from '@/lib/i18n';
import type { Bundle } from '@/lib/session-types';
import { kidMessages } from '@/messages/kid';

export const dynamic = 'force-dynamic';

/**
 * `/play/[sessionId]` — the kid-mode player (task.md § 8.3, design/05).
 *
 * The server only answers "is there a session here for you": an id that is
 * not ours (404) or a lapsed sign-in (401) gets a calm full-page state without
 * any JavaScript. Otherwise its read of the bundle seeds the client player,
 * which owns everything after that — download, offline buffer, sync, submit.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale, sessionId } = await params;
  if (!isLocale(locale)) notFound();
  const brand = getMessages(locale).brand;
  const t = kidMessages(locale);
  const home = `/${locale}/dashboard`;

  const res = UUID_RE.test(sessionId)
    ? await apiGet<Bundle>(`/api/sessions/${sessionId}/bundle`)
    : ({ ok: false, status: 404 } as const);

  if (!res.ok && (res.status === 404 || res.status === 401 || res.status === 403)) {
    const signedOut = res.status === 401;
    return (
      <>
        <KidBar brand={brand} />
        <main className="kid__stage kd-stage">
          <KidState
            tone={signedOut ? 'warning' : 'neutral'}
            icon={signedOut ? 'lock' : 'info'}
            title={signedOut ? t.soTitle : t.nfTitle}
            body={signedOut ? t.soBody : t.nfBody}
          >
            <Link href={signedOut ? `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/play/${sessionId}`)}` : home} className="fam-btn fam-btn--primary kd-btn">
              {signedOut ? t.soAction : t.dnHome}
            </Link>
          </KidState>
        </main>
      </>
    );
  }

  // A 5xx or an unreachable API: the client tries again itself and, failing
  // that, carries on from the copy saved on this device.
  return <KidPlayer locale={locale} sessionId={sessionId} brand={brand} initial={res.ok ? res.data : null} />;
}
