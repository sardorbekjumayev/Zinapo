import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { StateBlock } from '@/components/family/access/parts';
import { StatementForm } from '@/components/family/trust/StatementForm';
import { MAX_STATEMENTS, StageTag, outcomeText, stageOf } from '@/components/family/trust/shared';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { ChildSummary } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill, isLocale, type Locale } from '@/lib/i18n';
import type { FamilyDisputeDetail } from '@/lib/trust-types';
import { disputesMessages, type DisputesMessages } from '@/messages/disputes';
import { familyMessages } from '@/messages/family';

export const dynamic = 'force-dynamic';

/**
 * `/family/disputes/[id]` — one dispute as a party sees it (task.md § 8.2,
 * M8-c, M8-d): where the case is, what happens next, the outcome, and ONLY
 * this person's own statements. The other side's identity and words never
 * reach this page (the API leaves them out).
 */
export default async function DisputePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const m = disputesMessages(locale);
  const f = familyMessages(locale);
  const list = `/${locale}/family/disputes`;

  const res = await apiGet<FamilyDisputeDetail>(`/api/family/disputes/${encodeURIComponent(id)}`);
  if (!res.ok && res.status === 404) {
    return <StateBlock icon="alert" title={m.detail.notFoundTitle} body={m.detail.notFoundBody} href={list} cta={m.detail.back} />;
  }
  if (!res.ok) {
    return (
      <ErrorState
        title={m.detail.errTitle}
        body={m.detail.errBody}
        retryHref={`${list}/${encodeURIComponent(id)}`}
        retryLabel={f.common.retry}
      />
    );
  }

  const d = res.data;
  const decided = stageOf(d.status) === 'decided';
  const received = decided && d.role === 'claimant' && d.outcome === 'transferred';
  const links = received ? await handoverLinks(locale, d.childId) : null;

  return (
    <>
      <Link href={list} className="dp-back">
        <Icon name="arrowLeft" size={16} />
        {m.detail.back}
      </Link>

      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <span className="dp-headTags">
            <span className={d.role === 'claimant' ? 'fam-tag fam-tag--blue' : 'fam-tag fam-tag--teal'}>
              {d.role === 'claimant' ? m.list.roleClaimant : m.list.roleOwner}
            </span>
            <StageTag status={d.status} m={m} />
          </span>
          <h1 className="pageHead__title">
            {fill(d.role === 'claimant' ? m.detail.titleClaimant : m.detail.titleOwner, { child: d.childName })}
          </h1>
          <p className="card__body">
            {m.detail.refLabel}: <span className="mono dp-ref">{d.reference}</span>
          </p>
        </div>
      </div>

      <div className="fam-grid">
        <div className="fam-col">
          {decided && (
            <section className="fam-panel dp-outcome" aria-labelledby="dp-out-h">
              <span className="card__kicker">{m.detail.outcomeTitle}</span>
              <h2 id="dp-out-h" className="fam-panel__title">
                {outcomeText(d, m)}
              </h2>
              <p className="card__body">{outcomeBody(d, m)}</p>
              {links && (
                <div className="dp-actions">
                  <Link href={links.consents} className="fam-btn fam-btn--primary">
                    {m.detail.toConsents}
                  </Link>
                  <Link href={links.access} className="fam-btn">
                    {m.detail.toAccess}
                  </Link>
                  <Link href={links.child} className="fam-btn fam-btn--quiet">
                    {m.detail.toChild}
                  </Link>
                </div>
              )}
            </section>
          )}

          <section className="fam-panel" aria-labelledby="dp-st-h">
            <div>
              <h2 id="dp-st-h" className="fam-panel__title">
                {m.form.title}
              </h2>
              <p className="fam-panel__sub">{m.detail.privacy}</p>
            </div>
            {d.statements.length === 0 ? (
              <p className="fam-muted">{m.form.none}</p>
            ) : (
              <ol className="dp-statements">
                {d.statements.map((s) => (
                  <li key={s.id} className="dp-statement">
                    {/* Plain text: React escapes it, and pre-wrap keeps the
                        person's own line breaks. */}
                    <p className="dp-statement__body">{s.body}</p>
                    <span className="dp-statement__meta">
                      {fill(m.form.added, { date: `${formatDate(s.createdAt, locale)}, ${time(s.createdAt)}` })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {d.canWrite ? (
              <StatementForm caseId={d.id} written={d.statements.length} locale={locale} />
            ) : (
              <p className="fam-note">
                <Icon name="lock" size={18} />
                <span>{m.form.closed}</span>
              </p>
            )}
          </section>
        </div>

        <div className="fam-col">
          <section className="fam-panel" aria-labelledby="dp-tl-h">
            <h2 id="dp-tl-h" className="fam-panel__title">
              {m.detail.timelineTitle}
            </h2>
            <Timeline d={d} m={m} locale={locale} />
          </section>

          {!decided && (
            <section className="fam-panel" aria-labelledby="dp-nx-h">
              <h2 id="dp-nx-h" className="fam-panel__title">
                {m.detail.nextTitle}
              </h2>
              <ul className="dp-next">
                <li>
                  <Icon name="bell" size={18} />
                  <span>{m.detail.next1}</span>
                </li>
                <li>
                  <Icon name="file" size={18} />
                  <span>{m.detail.next2}</span>
                </li>
                <li>
                  <Icon name="shield" size={18} />
                  <span>{m.detail.next3}</span>
                </li>
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Timeline({ d, m, locale }: { d: FamilyDisputeDetail; m: DisputesMessages; locale: Locale }) {
  const decided = stageOf(d.status) === 'decided';
  const steps = [
    { title: m.detail.stepOpened, desc: formatDate(d.openedAt, locale), done: true },
    {
      title: m.detail.stepStatements,
      desc: decided ? fill(m.form.used, { n: d.statements.length, max: MAX_STATEMENTS }) : m.detail.stepStatementsNow,
      done: decided,
    },
    {
      title: m.detail.stepDecision,
      desc: decided && d.resolvedAt ? `${formatDate(d.resolvedAt, locale)} · ${outcomeText(d, m)}` : m.detail.stepDecisionNow,
      done: decided,
    },
  ];
  // The first unfinished step is "now".
  const now = steps.findIndex((s) => !s.done);
  return (
    <ol className="dp-steps">
      {steps.map((s, i) => (
        <li key={s.title} className="dp-step" data-state={s.done ? 'done' : i === now ? 'now' : 'todo'}>
          <span className="dp-step__dot" aria-hidden="true">
            {s.done ? <Icon name="check" size={14} /> : i + 1}
          </span>
          <span className="dp-step__body">
            <span className="dp-step__title">
              {s.title}
              {(s.done || i === now) && (
                <span className={s.done ? 'fam-tag fam-tag--ok' : 'fam-tag fam-tag--brand'}>
                  {s.done ? m.detail.tagDone : m.detail.tagNow}
                </span>
              )}
            </span>
            <span className="dp-step__desc">{s.desc}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function outcomeBody(d: FamilyDisputeDetail, m: DisputesMessages): string {
  const transferred = d.outcome === 'transferred';
  if (d.role === 'claimant') return transferred ? m.detail.outcomeTransferredClaimant : m.detail.outcomeKeptClaimant;
  return transferred ? m.detail.outcomeTransferredOwner : m.detail.outcomeKeptOwner;
}

/** Tashkent wall-clock time, so a statement reads the same on every server. */
function time(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }).format(new Date(iso));
}

/**
 * Where a claimant who won goes next (M8-c: consents ended, educator links
 * wait for their answer). The API names the child once this person holds it.
 */
async function handoverLinks(locale: Locale, childId: string | null) {
  const only = childId ? encodeURIComponent(childId) : null;
  const base = `/${locale}/family`;
  return {
    child: only ? `${base}/children/${only}` : base,
    // /family/consents lists every child on one page.
    consents: `${base}/consents`,
    access: only ? `${base}/access?child=${only}` : `${base}/access`,
  };
}
