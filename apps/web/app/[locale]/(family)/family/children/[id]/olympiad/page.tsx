import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/family/Avatar';
import { ErrorState } from '@/components/family/ErrorState';
import { OlympiadSection } from '@/components/family/olympiad/OlympiadView';
import { pick, seasonLabel } from '@/components/family/olympiad/util';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import { childDisplayName } from '@/lib/format';
import type { ChildSummary } from '@/lib/family-types';
import { fill, isLocale, type Locale } from '@/lib/i18n';
import type { FamilyOlympiadView } from '@/lib/olympiad-types';
import { olympiadMessages } from '@/messages/olympiad';

export const dynamic = 'force-dynamic';

/**
 * `/family/children/[id]/olympiad` — the parent's olympiad (design/07,
 * task.md § 8.1.6): the season's stages, the ticket, registration (owner
 * only), the child's own results and the privacy promise. A co-guardian sees
 * the same page read-only (§ 8.2).
 */
export default async function OlympiadPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const t = olympiadMessages(locale);
  const enc = encodeURIComponent(id);
  const self = `/${locale}/family/children/${id}/olympiad`;

  const [viewRes, childRes] = await Promise.all([
    apiGet<FamilyOlympiadView>(`/api/family/children/${enc}/olympiad`),
    apiGet<ChildSummary>(`/api/family/children/${enc}`),
  ]);

  if (!viewRes.ok) {
    if (viewRes.status === 400 || viewRes.status === 403 || viewRes.status === 404) return <NotFoundState locale={locale} />;
    return <ErrorState title={t.page.loadErrorTitle} body={t.page.loadErrorBody} retryHref={self} retryLabel={t.common.retry} />;
  }

  const view = viewRes.data;
  const name = view.child.givenName;
  // Who may register is the owner; if the child summary fails we fall back to read-only.
  const owner = childRes.ok && childRes.data.via === 'owner';
  const region = pick(locale, view.child.regionUz, view.child.regionRu);
  const gradeLabel = fill(t.common.grade, { n: view.child.grade });
  const fullName = childRes.ok ? childDisplayName(childRes.data) : name;
  const ctx = { view, owner, region, gradeLabel, childLine: `${fullName} · ${gradeLabel}`, locale, t };

  return (
    <>
      <Link href={`/${locale}/family/children/${id}`} className="fp-back">
        <Icon name="arrowLeft" size={16} />
        {fill(t.common.back, { name })}
      </Link>

      <header className="fam-panel ol-hero">
        <div className="ol-hero__text">
          <span className="card__kicker">{fill(t.page.kicker, { season: seasonLabel() })}</span>
          <h1 className="pageHead__title">{t.page.title}</h1>
          <p className="card__body">{t.page.sub}</p>
        </div>
        <span className="fam-tag fam-tag--brand ol-hero__free">{t.page.free}</span>
        <div className="ol-hero__child">
          <Avatar name={fullName} tone={owner ? 'brand' : 'blue'} />
          <span className="fam-small">{fill(t.page.childLine, { name: fullName, grade: gradeLabel, region })}</span>
        </div>
      </header>

      {!owner && (
        <p className="fam-note fam-note--brand" role="note">
          <Icon name="lock" size={18} />
          {fill(t.page.coNote, { name, owner: view.owner.name })}
        </p>
      )}

      {view.olympiads.length === 0 ? (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="trophy" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h2 className="state__title">{fill(t.page.emptyTitle, { name })}</h2>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {fill(t.page.emptyBody, { name })}
            </p>
          </div>
          <Link href={`/${locale}/family/children/${id}`} className="fam-btn fam-btn--primary">
            {fill(t.page.emptyCta, { name })}
          </Link>
        </section>
      ) : (
        view.olympiads.map((o) => <OlympiadSection key={o.id} olympiad={o} ctx={ctx} />)
      )}
    </>
  );
}

function NotFoundState({ locale }: { locale: Locale }) {
  const t = olympiadMessages(locale);
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="child" size={26} />
      </span>
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <h1 className="state__title">{t.common.notFoundTitle}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {t.common.notFoundBody}
        </p>
      </div>
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary">
        <Icon name="arrowLeft" size={18} />
        {t.common.toChildren}
      </Link>
    </section>
  );
}
