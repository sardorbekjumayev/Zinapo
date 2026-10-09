import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { StageTimeline } from '@/components/family/olympiad/StageTimeline';
import { pick, seasonLabel } from '@/components/family/olympiad/util';
import { SrcCookie } from '@/components/public/olympiad/SrcCookie';
import { Icon } from '@/components/shell/Icon';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { fill, isLocale } from '@/lib/i18n';
import { fetchMe } from '@/lib/me';
import type { PublicOlympiad } from '@/lib/olympiad-types';
import { olympiadMessages } from '@/messages/olympiad';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{2,64}$/;
const SRC = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * `/o/[slug]` — the olympiad's public landing, where shared links and ads
 * point (task.md § 8.1.6). Public: no names, no results, just what it is and
 * how to take part. Registration itself happens on the child's page.
 */
export default async function OlympiadLanding({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  const [{ locale, slug }, sp] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();
  const t = olympiadMessages(locale);
  const p = t.public;
  const src = typeof sp.src === 'string' && SRC.test(sp.src) ? sp.src : null;

  const [me, res] = await Promise.all([
    fetchMe(),
    SLUG.test(slug)
      ? apiGet<PublicOlympiad>(`/api/public/olympiads/${encodeURIComponent(slug)}`)
      : Promise.resolve({ ok: false as const, status: 404 }),
  ]);

  if (!res.ok && res.status !== 404) {
    return <ErrorState title={p.errTitle} body={p.errBody} retryHref={`/${locale}/o/${encodeURIComponent(slug)}`} retryLabel={t.common.retry} />;
  }
  if (!res.ok) {
    return (
      <StateBlock
        icon="trophy"
        title={p.notFoundTitle}
        body={p.notFoundBody}
        links={[{ href: me ? `/${locale}/family` : `/${locale}/sign-in`, label: me ? p.ctaSignedIn : p.notFoundCta, primary: true }]}
      />
    );
  }

  const o = res.data;
  const family = `/${locale}/family`;
  const href = me ? family : `/${locale}/sign-in?next=${encodeURIComponent(family)}`;
  const title = pick(locale, o.titleUz, o.titleRu);

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      {src && <SrcCookie src={src} />}
      <section className="fam-panel ol-landing">
        <span className="card__kicker">{fill(p.kicker, { season: seasonLabel() })}</span>
        <h1 className="pageHead__title">{title}</h1>
        <div className="fam-inline">
          <span className="fam-tag fam-tag--brand">{fill(p.grades, { a: o.gradeMin, b: o.gradeMax })}</span>
          <span className="fam-tag fam-tag--ok">{p.free}</span>
          {!o.isRanked && <span className="fam-tag">{t.marathon.chip}</span>}
        </div>
        <p className="card__body">{o.isRanked ? p.sub : p.marathonSub}</p>
        <div className="fam-inline">
          <Link href={href} className="fam-btn fam-btn--primary">
            {me ? p.ctaSignedIn : p.ctaSignedOut}
            <Icon name="arrowRight" size={18} />
          </Link>
          <span className="fam-muted fam-small">{p.ctaHint}</span>
        </div>
      </section>

      <section className="fam-panel" aria-labelledby="ol-landing-stages">
        <h2 id="ol-landing-stages" className="fam-panel__title">
          {p.stagesTitle}
        </h2>
        <StageTimeline stages={o.stages} isRanked={o.isRanked} locale={locale} t={t} label={p.stagesTitle} />
      </section>

      <p className="fam-note fam-note--brand">
        <Icon name="lock" size={18} />
        <span>
          <strong>{p.privacyTitle}. </strong>
          {p.privacyBody}
        </span>
      </p>
    </div>
  );
}
