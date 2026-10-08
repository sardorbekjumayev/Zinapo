import { notFound } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { getMessages, isLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * `/play/[sessionId]` — the kid-mode player. M4 builds the real thing:
 * ready → test → review → done, with an offline buffer and a retrying sync.
 *
 * The route and its chrome-free layout exist now so the shell is complete and
 * the session-launch flow has somewhere to land.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getMessages(locale);

  return (
    <>
      <div className="kid__bar">
        <span className="ws__brandMark">
          <Icon name="logo" size={22} strokeWidth={2} />
        </span>
        <span className="ws__brandName">{t.brand}</span>
        {/* Violet is monitoring, teal is practice (task.md § 7.1). The real
            player picks the mode from the session. */}
        <span className="chip chip--monitoring" style={{ marginLeft: 'auto' }}>
          <Icon name="clock" size={16} />
          {t.nav.reports}
        </span>
      </div>

      <div className="kid__stage">
        <span className="state__icon state__icon--empty">
          <Icon name="clock" size={26} />
        </span>
        <h1 className="state__title">{t.soon.kicker}</h1>
        <p className="card__body" style={{ maxWidth: '48ch', textAlign: 'center' }}>
          {t.soon.body}
        </p>
        <span className="chip chip--neutral mono">M4 — Sessions &amp; kid mode</span>
      </div>
    </>
  );
}
