import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { EducatorProfile } from '@/lib/educator-types';
import { formatDate, regionName } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/workspace-guard';
import { invitesMessages } from '@/messages/invites';

export const dynamic = 'force-dynamic';

/**
 * `/educator/pending` — an application waiting for trust & safety (task.md
 * § 2.2, § 8.5). A rejected applicant loses the educator workspace, so the
 * layout usually sends them on; /educator/apply shows them the reason too.
 */
export default async function PendingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale } = await requireWorkspace(raw, 'educator');
  const m = invitesMessages(locale);
  const t = m.pending;

  const res = await apiGet<EducatorProfile>('/api/educator/profile');
  if (!res.ok) {
    return <ErrorState title={t.errTitle} body={t.errBody} retryHref={`/${locale}/educator/pending`} retryLabel={m.common.retry} />;
  }
  const p = res.data;
  if (p.status === 'approved') redirect(`/${locale}/educator`);
  if (p.status === null) redirect(`/${locale}/educator/apply`);

  if (p.status === 'rejected' || p.status === 'suspended') {
    return (
      <section className="state">
        <span className="state__icon state__icon--error">
          <Icon name="alert" size={26} />
        </span>
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 className="state__title">{t.rejectedTitle}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.rejectedBody}
          </p>
          {p.note && <p className="fam-note fam-note--warn">{fill(t.reason, { note: p.note })}</p>}
        </div>
        <Link href={`/${locale}/educator/apply`} className="fam-btn fam-btn--primary">
          {t.applyAgain}
        </Link>
      </section>
    );
  }

  const facts: { label: string; value: string }[] = [
    {
      label: t.asT,
      value: fill(t.as, { kind: p.kind ? m.common.kind[p.kind] : '—', date: formatDate(p.appliedAt, locale) }),
    },
    ...(p.region ? [{ label: t.region, value: regionName(p.region, locale) }] : []),
    ...(p.school ? [{ label: t.school, value: p.school.name }] : []),
    ...(p.subjects?.length ? [{ label: t.subjects, value: p.subjects.map((s) => m.common.subject[s]).join(', ') }] : []),
  ];

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <span className="card__kicker">{t.kicker}</span>
          <h1 className="pageHead__title">{t.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.subtitle}
          </p>
        </div>
        <span className="chip chip--warning">
          <Icon name="clock" size={16} />
          {m.common.kind[p.kind ?? 'tutor']}
        </span>
      </div>

      <div className="iv-top">
        <section className="fam-panel" aria-labelledby="iv-pend-next">
          <h2 id="iv-pend-next" className="fam-panel__title">
            {t.nextT}
          </h2>
          <ol className="iv-steps">
            {[t.next1, t.next2, t.next3].map((s, i) => (
              <li key={s} className="iv-step">
                <span className="iv-step__icon" aria-hidden="true">
                  {i + 1}
                </span>
                <p className="card__body">{s}</p>
              </li>
            ))}
          </ol>
          <div className="fam-note fam-note--brand">
            <Icon name="lock" size={18} />
            <div>
              <strong>{t.nowT}</strong>
              {t.nowD}
            </div>
          </div>
        </section>
        <section className="fam-panel" aria-label={t.asT}>
          <dl className="iv-facts">
            {facts.map((f) => (
              <div key={f.label} className="iv-facts__row">
                <dt className="fam-small fam-muted">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
