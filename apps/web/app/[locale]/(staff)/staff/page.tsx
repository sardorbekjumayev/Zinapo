import Link from 'next/link';
import { Icon, type IconName } from '@/components/shell/Icon';
import { getMessages } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/workspace-guard';
import type { Me, StaffRole } from '@/lib/me';

export const dynamic = 'force-dynamic';

/**
 * `/staff` — the role-aware home (task.md § 7: "queues with counts").
 *
 * One card per queue the person's roles actually unlock, so an item author
 * sees one card and a super admin sees three. The counts are M3+; the cards
 * are here now because "which queues are mine" is the M1 question.
 */
export default async function StaffHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const t = getMessages(locale);

  const cards = queuesFor(me).map((q) => ({
    ...q,
    href: `/${locale}/staff/${q.href}`,
    label: t.nav[q.key],
  }));

  return (
    <>
      <div className="pageHead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.nav.staffQueues}</span>
          <h1 className="pageHead__title">{t.nav.staffHome}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {(me.staff?.roles ?? []).map((role) => t.staffRole[role]).join(' · ')}
          </p>
        </div>
      </div>

      {cards.length === 0 ? (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="alert" size={26} />
          </span>
          <h2 className="state__title">{t.states.emptyTitle}</h2>
          <p className="card__body">{t.states.emptyBody}</p>
        </section>
      ) : (
        <div className="tiles">
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className="tile tile--link lift">
              <span className="tile__icon">
                <Icon name={card.icon} />
              </span>
              <span className="card__title">{card.label}</span>
              <span className="chip chip--neutral mono" style={{ alignSelf: 'flex-start' }}>
                {card.milestone}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Mirrors STAFF_NAV in components/shell/nav-items.ts, plus the milestone. */
const QUEUES: {
  roles: StaffRole[];
  key: 'items' | 'review' | 'forms' | 'calibration' | 'seasons' | 'olympiads' | 'finals' | 'cases' | 'outcomes' | 'people' | 'roles' | 'audit';
  href: string;
  icon: IconName;
  milestone: string;
}[] = [
  { roles: ['item_author', 'bank_editor'], key: 'items', href: 'items', icon: 'bank', milestone: 'M3' },
  { roles: ['item_reviewer'], key: 'review', href: 'review', icon: 'check', milestone: 'M3' },
  { roles: ['bank_editor'], key: 'forms', href: 'forms', icon: 'file', milestone: 'M3' },
  { roles: ['bank_editor'], key: 'calibration', href: 'calibration', icon: 'gauge', milestone: 'M5' },
  { roles: ['season_manager'], key: 'seasons', href: 'seasons', icon: 'calendar', milestone: 'M4' },
  { roles: ['olympiad_operator'], key: 'olympiads', href: 'olympiads', icon: 'trophy', milestone: 'M7' },
  { roles: ['proctor'], key: 'finals', href: 'finals', icon: 'play', milestone: 'M7' },
  { roles: ['trust_safety'], key: 'cases', href: 'cases', icon: 'flag', milestone: 'M8' },
  { roles: ['outcomes_operator'], key: 'outcomes', href: 'outcomes', icon: 'trend', milestone: 'M9' },
  { roles: ['support', 'trust_safety'], key: 'people', href: 'people', icon: 'user', milestone: 'M9' },
  { roles: ['super_admin'], key: 'roles', href: 'roles', icon: 'settings', milestone: 'M9' },
  { roles: ['super_admin'], key: 'audit', href: 'audit', icon: 'list', milestone: 'M9' },
];

function queuesFor(me: Me) {
  const held = new Set(me.staff?.roles ?? []);
  return QUEUES.filter((q) => q.roles.some((role) => held.has(role)));
}
