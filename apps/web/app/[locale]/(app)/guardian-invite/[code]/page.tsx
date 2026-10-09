import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Avatar } from '@/components/family/Avatar';
import { ErrorState } from '@/components/family/ErrorState';
import { InviteDecision } from '@/components/family/home/InviteDecision';
import { loadInvite } from '@/components/family/home/load-invite';
import { Icon, type IconName } from '@/components/shell/Icon';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { formatDate } from '@/lib/format';
import { fill, getMessages, isLocale, type Locale } from '@/lib/i18n';
import { fetchMe } from '@/lib/me';
import { familyMessages } from '@/messages/family';
import { homeMessages } from '@/messages/home';

export const dynamic = 'force-dynamic';

/**
 * `/guardian-invite/[code]` — a co-guardian invitation or an ownership offer
 * (task.md § 8.2, § 12 M2). Outside every workspace on purpose: the invitee
 * often has none yet, and accepting is what gives them one.
 *
 * The invite is bound to the phone the owner typed; the API answers
 * "not found" for any other number, so this page never learns more than the
 * signed-in person may know.
 */
export default async function GuardianInvitePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();

  const me = await fetchMe();
  if (!me) redirect(`/${locale}/sign-in?next=/${locale}/guardian-invite/${encodeURIComponent(code)}`);

  const t = getMessages(locale);
  const fm = familyMessages(locale);
  const m = homeMessages(locale).invite;
  const load = await loadInvite(code);

  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }}>
        <header className="ws__header">
          <Link href={`/${locale}/dashboard`} className="ws__brand" aria-label={t.brand}>
            <span className="ws__brandMark">
              <Icon name="logo" size={22} strokeWidth={2} />
            </span>
            <span className="ws__brandName">{t.brand}</span>
          </Link>
          <div className="ws__crumb" />
          <LocaleSwitcher locale={locale} label={t.nav.langLabel} />
          <ThemeToggle label={t.themeToggle} />
        </header>

        {load.state === 'ok' ? (
          <InviteBody locale={locale} code={code} invite={load.invite} />
        ) : load.state === 'error' ? (
          <ErrorState
            title={m.errorTitle}
            body={m.errorBody}
            retryHref={`/${locale}/guardian-invite/${encodeURIComponent(code)}`}
            retryLabel={fm.common.retry}
          />
        ) : (
          <Dead
            locale={locale}
            icon={load.state === 'expired' ? 'clock' : load.state === 'used' ? 'check' : 'mail'}
            title={load.state === 'expired' ? m.expiredTitle : load.state === 'used' ? m.usedTitle : m.notFoundTitle}
            body={load.state === 'expired' ? m.expiredBody : load.state === 'used' ? m.usedBody : m.notFoundBody}
            note={load.state === 'not_found' ? fill(m.signedInAs, { phone: me.person.phone }) : null}
          />
        )}
      </main>
    </div>
  );
}

function InviteBody({
  locale,
  code,
  invite,
}: {
  locale: Locale;
  code: string;
  invite: { kind: 'co_guardian' | 'ownership_transfer'; childName: string; childGrade: number | null; inviterName: string; expiresAt: string };
}) {
  const fm = familyMessages(locale);
  const m = homeMessages(locale).invite;
  const own = invite.kind === 'ownership_transfer';
  const vars = { inviter: invite.inviterName, child: invite.childName };
  const points = own ? [m.own1, m.own2, m.own3] : [m.co1, m.co2, m.co3];

  return (
    <section className="fam-panel fp-landing" aria-labelledby="fp-invite-title">
      <span className="card__kicker">{m.kicker}</span>
      <div className="fp-head">
        <Avatar name={invite.inviterName} size="lg" />
        <div className="fp-head__body">
          <h1 id="fp-invite-title" className="fp-landing__title">
            {fill(own ? m.titleOwn : m.titleCo, vars)}
          </h1>
          <p className="fam-caption">
            <Icon name="clock" size={14} />
            {fill(m.expires, { date: formatDate(invite.expiresAt, locale) })}
          </p>
        </div>
      </div>

      <div className="fp-landing__child">
        <Avatar name={invite.childName} tone="blue" />
        <div className="fam-person__body">
          <span className="fam-person__name">{invite.childName}</span>
          {invite.childGrade !== null && (
            <span className="fam-person__desc">{fm.grade[String(invite.childGrade) as keyof typeof fm.grade]}</span>
          )}
        </div>
        <span className={own ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>
          {own ? fm.role.owner : fm.role.co_guardian}
        </span>
      </div>

      <div className="fam-stack">
        <h2 className="fp-h3">{m.meansTitle}</h2>
        <ul className="fp-points">
          {points.map((p) => (
            <li key={p}>
              <Icon name="check" size={16} />
              <span>{fill(p, vars)}</span>
            </li>
          ))}
        </ul>
      </div>

      <hr className="fam-divider" />
      <InviteDecision
        code={code}
        locale={locale}
        copy={{
          accept: m.accept,
          decline: m.decline,
          declineTitle: m.declineTitle,
          declineBody: fill(m.declineBody, vars),
          cancel: fm.common.cancel,
          accepting: m.accepting,
          declinedTitle: m.declinedTitle,
          declinedBody: fill(m.declinedBody, vars),
          toDashboard: m.toDashboard,
          expired: m.expiredTitle,
          used: m.usedTitle,
          notFound: m.notFoundBody,
          already: m.errAlready,
          networkError: fm.common.networkError,
          genericError: fm.common.genericError,
        }}
      />
    </section>
  );
}

function Dead({
  locale,
  icon,
  title,
  body,
  note,
}: {
  locale: Locale;
  icon: IconName;
  title: string;
  body: string;
  note: string | null;
}) {
  const m = homeMessages(locale).invite;
  return (
    <section className="state" role="alert">
      <span className="state__icon state__icon--empty">
        <Icon name={icon} size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{title}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
        {note && <p className="fam-caption">{note}</p>}
      </div>
      <Link href={`/${locale}/dashboard`} className="fam-btn fam-btn--primary">
        {m.toDashboard}
      </Link>
    </section>
  );
}
