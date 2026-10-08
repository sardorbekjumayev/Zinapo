import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { fill, getMessages } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/**
 * `/family` — the parent's home. task.md § 7 says it goes to the first child's
 * report; until M5 builds that report this shows what M1 actually knows: how
 * many children, in which relationship, and the one next action.
 *
 * The empty state is the one that matters most here, because a parent who has
 * just signed in from an educator invite lands on it.
 */
export default async function FamilyHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'family');
  const t = getMessages(locale);

  const owned = me.family?.ownerOf ?? 0;
  const coGuarded = me.family?.coGuardianOf ?? 0;
  const total = owned + coGuarded;

  if (total === 0) {
    return (
      <section className="state">
        <span className="state__icon state__icon--empty">
          <Icon name="child" size={26} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.onboarding.kicker}</span>
          <h1 className="state__title">{t.onboarding.parentTitle}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.onboarding.parentBody}
          </p>
        </div>
        <Link
          href={`/${locale}/family/children/new`}
          className="onb__cta onb__cta--primary lift"
          style={{ marginTop: 0, textDecoration: 'none' }}
        >
          {t.onboarding.parentCta}
          <Icon name="arrowRight" size={18} />
        </Link>
      </section>
    );
  }

  return (
    <>
      <div className="pageHead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.nav.familyChildren}</span>
          <h1 className="pageHead__title">{fill(t.nav.noteChildren, { n: total })}</h1>
          <p className="card__body">{t.nav.noteChildrenSub}</p>
        </div>
        <Link
          href={`/${locale}/family/children/new`}
          className="onb__cta onb__cta--primary lift"
          style={{ marginTop: 0, textDecoration: 'none', minWidth: 220 }}
        >
          <Icon name="plus" size={18} />
          {t.nav.addChild}
        </Link>
      </div>

      <div className="tiles">
        <Tile
          kicker={t.workspace.family}
          value={String(owned)}
          caption={`${t.nav.reports} · ${t.workspace.family}`}
          icon="child"
        />
        {coGuarded > 0 && (
          <Tile
            kicker={t.nav.access}
            value={String(coGuarded)}
            caption={t.nav.consents}
            icon="users"
          />
        )}
      </div>

      {/* The report itself is M5. Saying so beats an empty card that looks
          like a bug. */}
      <section className="card">
        <span className="card__kicker">{t.soon.kicker}</span>
        <h2 className="card__title">{t.nav.reports}</h2>
        <p className="card__body">{t.soon.body}</p>
        <span className="chip chip--neutral mono" style={{ alignSelf: 'flex-start' }}>
          M5 — Measurement v0 &amp; parent reports
        </span>
      </section>
    </>
  );
}

function Tile({
  kicker,
  value,
  caption,
  icon,
}: {
  kicker: string;
  value: string;
  caption: string;
  icon: 'child' | 'users';
}) {
  return (
    <div className="tile">
      <span className="tile__icon">
        <Icon name={icon} />
      </span>
      <span className="card__kicker">{kicker}</span>
      <span className="tile__value">{value}</span>
      <span className="ws__noteBody">{caption}</span>
    </div>
  );
}
