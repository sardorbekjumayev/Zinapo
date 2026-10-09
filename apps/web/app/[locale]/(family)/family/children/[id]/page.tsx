import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/family/Avatar';
import { ErrorState } from '@/components/family/ErrorState';
import { ChildDetails } from '@/components/family/home/ChildDetails';
import { EnrolmentForm } from '@/components/family/home/EnrolmentForm';
import { WavesCard } from '@/components/family/waves/WavesCard';
import { ParentReport } from '@/components/family/report/ParentReport';
import { PracticeCard } from '@/components/family/practice/PracticeCard';
import { currentSchoolYear, schoolLine, schoolYearLabel } from '@/components/family/home/labels';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import { childDisplayName, formatDate, regionName } from '@/lib/format';
import type { ChildSummary, Enrolment, Region } from '@/lib/family-types';
import type { ChildWaves } from '@/lib/session-types';
import type { Report } from '@/lib/report-types';
import type { FamilyPractice } from '@/lib/educator-types';
import { fill, isLocale, type Locale } from '@/lib/i18n';
import { familyMessages } from '@/messages/family';
import { homeMessages } from '@/messages/home';
import { reportMessages } from '@/messages/report';
import { olympiadMessages } from '@/messages/olympiad';

export const dynamic = 'force-dynamic';

/**
 * `/family/children/[id]` — the child's page. The report (task.md § 8.1.3) is
 * the main content; below it the waves, the enrolment history and, for the
 * owner, the two things they can change here (names, school/grade).
 *
 * A co-guardian sees the same page read-only (task.md § 8.2). The API
 * enforces that too; hiding the controls is only so nobody hits a 403.
 */
export default async function ChildPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const fm = familyMessages(locale);
  const m = homeMessages(locale).child;
  const enc = encodeURIComponent(id);

  const [childRes, enrolRes, regionsRes, wavesRes, reportRes, practiceRes] = await Promise.all([
    apiGet<ChildSummary>(`/api/family/children/${enc}`),
    apiGet<Enrolment[]>(`/api/family/children/${enc}/enrolments`),
    apiGet<Region[]>('/api/reference/regions'),
    apiGet<ChildWaves>(`/api/family/children/${enc}/waves`),
    apiGet<Report>(`/api/family/children/${enc}/report`),
    apiGet<FamilyPractice[]>(`/api/family/children/${enc}/practice`),
  ]);

  if (!childRes.ok) {
    // 403/404: not yours, or gone. Same answer either way — no hint that a
    // child exists behind an id you can't see.
    if (childRes.status === 403 || childRes.status === 404 || childRes.status === 400) {
      return <NotFoundState locale={locale} />;
    }
    return (
      <ErrorState
        title={m.loadErrorTitle}
        body={m.loadErrorBody}
        retryHref={`/${locale}/family/children/${id}`}
        retryLabel={fm.common.retry}
      />
    );
  }
  if (!enrolRes.ok) {
    return (
      <ErrorState
        title={m.loadErrorTitle}
        body={m.loadErrorBody}
        retryHref={`/${locale}/family/children/${id}`}
        retryLabel={fm.common.retry}
      />
    );
  }

  const child = childRes.data;
  const enrolments = enrolRes.data;
  const regions = regionsRes.ok ? regionsRes.data : [];
  const owner = child.via === 'owner';
  const name = childDisplayName(child);
  const grade = (n: number) => fm.grade[String(n) as keyof typeof fm.grade];
  const thisYear = currentSchoolYear();
  const accessHref = `/${locale}/family/access?child=${child.id}`;

  return (
    <>
      <Link href={`/${locale}/family`} className="fp-back">
        <Icon name="arrowLeft" size={16} />
        {fm.common.toChildren}
      </Link>

      <header className="fp-head">
        <Avatar name={name} tone={owner ? 'brand' : 'blue'} size="lg" />
        <div className="fp-head__body">
          <h1 className="pageHead__title">{name}</h1>
          <p className="card__body">
            {[child.grade !== null ? grade(child.grade) : null, schoolLine(child, locale, homeMessages(locale).home.schoolNotListed)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className={owner ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>
          {owner ? fm.role.owner : fm.role.co_guardian}
        </span>
      </header>

      {child.deletionRequested && (
        <div className="fam-note fam-note--danger" role="note">
          <Icon name="trash" size={18} />
          <div>
            <strong>{m.deletionTitle}</strong>
            {m.deletionBody}{' '}
            <Link href={accessHref} className="fp-link">
              {m.deletionLink}
            </Link>
          </div>
        </div>
      )}

      {/* The report fails on its own: names, waves and access below still work. */}
      {reportRes.ok ? (
        <ParentReport report={reportRes.data} locale={locale} childId={child.id} owner={owner} />
      ) : (
        <ErrorState
          title={fill(reportMessages(locale).common.loadErrorTitle, { name: child.givenName })}
          body={reportMessages(locale).common.loadErrorBody}
          retryHref={`/${locale}/family/children/${id}`}
          retryLabel={fm.common.retry}
        />
      )}

      <div className="fam-grid">
        <div className="fam-col">
          <WavesCard
            data={wavesRes.ok ? wavesRes.data : null}
            childId={child.id}
            childName={child.givenName}
            gradeLabel={child.grade !== null ? grade(child.grade) : null}
            locale={locale}
            retryHref={`/${locale}/family/children/${id}`}
          />

          {/* M6: sets an educator assigned. A failure only costs this card. */}
          <PracticeCard
            data={practiceRes.ok ? practiceRes.data : null}
            childId={child.id}
            childName={child.givenName}
            locale={locale}
            retryHref={`/${locale}/family/children/${id}`}
          />

          <section className="fam-panel" aria-labelledby="fp-school-title">
            <div>
              <h2 id="fp-school-title" className="fam-panel__title">
                {m.schoolTitle}
              </h2>
              <p className="fam-panel__sub">{m.schoolSub}</p>
            </div>

            {enrolments.length === 0 ? (
              <p className="fam-note">
                <Icon name="info" size={18} />
                {m.historyEmpty}
              </p>
            ) : (
              <ol className="fp-timeline">
                {enrolments.map((e) => (
                  <li key={e.id} className={e.endedAt ? 'fp-timeline__item' : 'fp-timeline__item fp-timeline__item--current'}>
                    <span className="fp-timeline__dot" aria-hidden="true" />
                    <div className="fp-timeline__body">
                      <div className="fam-inline">
                        <span className="fp-timeline__year">{schoolYearLabel(e.schoolYear, m.schoolYear)}</span>
                        <span className={e.endedAt ? 'fam-tag' : 'fam-tag fam-tag--ok'}>
                          {e.endedAt ? fill(m.ended, { date: formatDate(e.endedAt, locale) }) : m.current}
                        </span>
                      </div>
                      <span className="fp-timeline__main">
                        {grade(e.grade)} · {e.schoolName ?? homeMessages(locale).home.schoolNotListed}
                      </span>
                      <span className="fam-muted fam-small">
                        {regionName({ nameUz: e.regionNameUz, nameRu: e.regionNameRu }, locale)} ·{' '}
                        {fill(m.since, { date: formatDate(e.startedAt, locale) })}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <hr className="fam-divider" />
            {!owner ? (
              <p className="fam-caption">
                <Icon name="lock" size={14} />
                {m.coSchoolNote}
              </p>
            ) : child.deletionRequested ? (
              <p className="fam-caption">
                <Icon name="lock" size={14} />
                {m.pendingLocked}
              </p>
            ) : (
              <EnrolmentForm
                childId={child.id}
                years={[thisYear, thisYear + 1].map((y) => ({ value: y, label: schoolYearLabel(y, m.schoolYear) }))}
                grades={[0, 1, 2, 3, 4].map((g) => ({ value: g, label: grade(g) }))}
                regions={regions.map((r) => ({ id: r.id, name: regionName(r, locale) }))}
                initial={{
                  schoolYear: thisYear,
                  grade: child.grade,
                  regionId: child.schoolRegionId,
                  schoolId: child.schoolId,
                }}
                copy={{
                  title: m.formTitle,
                  sub: m.formSub,
                  yearLabel: m.yearLabel,
                  gradeLabel: m.gradeLabel,
                  regionLabel: m.regionLabel,
                  regionChoose: m.regionChoose,
                  schoolLabel: m.schoolLabel,
                  schoolChoose: m.schoolChoose,
                  schoolNotListedOption: m.schoolNotListedOption,
                  schoolsLoading: m.schoolsLoading,
                  schoolsEmpty: m.schoolsEmpty,
                  schoolsError: m.schoolsError,
                  regionCap: m.regionCap,
                  submit: m.submit,
                  added: m.added,
                  errSchoolRegion: m.errSchoolRegion,
                  errPending: m.errPending,
                  networkError: fm.common.networkError,
                  genericError: fm.common.genericError,
                }}
              />
            )}
          </section>
        </div>

        <div className="fam-col">
          <section className="fam-panel" aria-labelledby="fp-details-title">
            <div>
              <h2 id="fp-details-title" className="fam-panel__title">
                {m.detailsTitle}
              </h2>
              <p className="fam-panel__sub">{m.detailsSub}</p>
            </div>
            <ChildDetails
              childId={child.id}
              initial={{
                familyName: child.familyName,
                givenName: child.givenName,
                patronymic: child.patronymic ?? '',
              }}
              dobLabel={formatDate(child.dob, locale)}
              canEdit={owner}
              copy={{
                familyName: m.familyName,
                givenName: m.givenName,
                patronymic: m.patronymic,
                dob: m.dob,
                none: m.none,
                edit: m.edit,
                save: fm.common.save,
                cancel: fm.common.cancel,
                saved: m.saved,
                required: m.required,
                tooLong: m.tooLong,
                networkError: fm.common.networkError,
                genericError: fm.common.genericError,
              }}
            />
            {!owner && (
              <p className="fam-note fam-note--brand">
                <Icon name="lock" size={18} />
                {fill(m.coNote, { owner: child.ownerName ?? '—' })}
              </p>
            )}
          </section>

          <Link href={accessHref} className="fp-linkCard lift">
            <span className="fp-invite__icon" aria-hidden="true">
              <Icon name="shield" size={20} />
            </span>
            <span className="fp-invite__body">
              <span className="fp-invite__title">{m.accessTitle}</span>
              <span className="fam-muted fam-small">{m.accessBody}</span>
            </span>
            <Icon name="arrowRight" size={18} />
          </Link>

          {/* M7: the way into the parent's olympiad (task.md § 8.1.6). */}
          <Link href={`/${locale}/family/children/${child.id}/olympiad`} className="fp-linkCard lift">
            <span className="fp-invite__icon" aria-hidden="true">
              <Icon name="trophy" size={20} />
            </span>
            <span className="fp-invite__body">
              <span className="fp-invite__title">{olympiadMessages(locale).entry.title}</span>
              <span className="fam-muted fam-small">{olympiadMessages(locale).entry.body}</span>
            </span>
            <Icon name="arrowRight" size={18} />
          </Link>
        </div>
      </div>
    </>
  );
}

function NotFoundState({ locale }: { locale: Locale }) {
  const fm = familyMessages(locale);
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="child" size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{fm.common.notFoundTitle}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {fm.common.notFoundBody}
        </p>
      </div>
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary">
        <Icon name="arrowLeft" size={18} />
        {fm.common.toChildren}
      </Link>
    </section>
  );
}
