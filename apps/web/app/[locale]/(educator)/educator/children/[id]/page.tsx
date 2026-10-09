import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { PupilView } from '@/components/educator/cabinet/PupilView';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { Pupil } from '@/lib/educator-types';
import { isLocale, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';

export const dynamic = 'force-dynamic';

/** `/educator/children/[id]` — design/08's pupil panel as a full page (task.md § 8.4.4). */
export default async function PupilPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const m = educatorMessages(locale);

  const res = await apiGet<Pupil>(`/api/educator/children/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 403) redirect(`/${locale}/educator`);
    // 404 without an ACTIVE link: the same answer whether the child exists or not.
    if (res.status === 404 || res.status === 400) return <PupilNotFound locale={locale} />;
    return (
      <ErrorState
        title={m.pupil.loadError}
        body={m.home.loadErrorBody}
        retryHref={`/${locale}/educator/children/${id}`}
        retryLabel={m.common.retry}
      />
    );
  }

  const pupil = res.data;
  const back = pupil.groups[0];

  return (
    <>
      <Link href={back ? `/${locale}/educator/groups/${back.id}` : `/${locale}/educator`} className="ed-back">
        <Icon name="arrowLeft" size={16} />
        {back ? back.name : m.common.toCabinet}
      </Link>
      <section className="fam-panel">
        <PupilView pupil={pupil} locale={locale} />
      </section>
    </>
  );
}

function PupilNotFound({ locale }: { locale: Locale }) {
  const m = educatorMessages(locale);
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="child" size={26} />
      </span>
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <h1 className="state__title">{m.pupil.notFoundTitle}</h1>
        <p className="card__body ed-measure">{m.pupil.notFoundBody}</p>
      </div>
      <Link href={`/${locale}/educator`} className="fam-btn fam-btn--primary">
        <Icon name="arrowLeft" size={18} />
        {m.common.toCabinet}
      </Link>
    </section>
  );
}
