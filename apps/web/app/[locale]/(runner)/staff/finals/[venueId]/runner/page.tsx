import { notFound } from 'next/navigation';
import { KidBar } from '@/components/kid/KidBar';
import { Runner } from '@/components/staff/finals/runner/Runner';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { getMessages, isLocale } from '@/lib/i18n';
import type { Roster } from '@/lib/olympiad-types';
import { finalsMessages } from '@/messages/finals';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/staff/finals/[venueId]/runner` — the browser offline runner (task.md § 11,
 * note M7-a). The server only confirms the venue is this proctor's; the
 * client owns everything after that and works from IndexedDB, so an API that
 * is down here does not stop a runner that already holds its package.
 */
export default async function RunnerPage({ params }: { params: Promise<{ locale: string; venueId: string }> }) {
  const { locale, venueId } = await params;
  if (!isLocale(locale)) notFound();
  const m = finalsMessages(locale);
  const brand = getMessages(locale).brand;
  const home = `/${locale}/staff/finals`;

  const res = UUID_RE.test(venueId)
    ? await apiGet<Roster>(`/api/staff/finals/${venueId}`)
    : ({ ok: false, status: 404 } as const);

  if (!res.ok && (res.status === 404 || res.status === 403)) {
    const nf = res.status === 404;
    return (
      <>
        <KidBar brand={brand} />
        <main className="kid__stage kd-stage">
          <StateBlock
            icon={nf ? 'pin' : 'lock'}
            tone={nf ? 'empty' : 'error'}
            title={nf ? m.states.nfTitle : m.states.noAccessTitle}
            body={nf ? m.states.nfBody : m.states.noAccessBody}
            links={[{ href: nf ? home : `/${locale}/staff`, label: nf ? m.states.nfCta : m.states.noAccessCta, primary: true }]}
          />
        </main>
      </>
    );
  }

  return (
    <Runner
      locale={locale}
      venueId={venueId}
      venueName={res.ok ? res.data.venue.name : null}
      brand={brand}
      rosterHref={`${home}/${venueId}`}
    />
  );
}
