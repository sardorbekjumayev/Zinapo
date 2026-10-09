import Link from 'next/link';
import { Icon, type IconName } from '@/components/shell/Icon';
import type { ItemListRow, ItemStatus } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { BankMessages } from '@/messages/bank';

export type ItemRole = 'core' | 'anchor_h' | 'anchor_v' | 'pretest';

/**
 * The role column, read the way the API's `role` filter reads it
 * (items.service list): anchors first, then approved = core, accepted =
 * pretest-only. Anything not yet decided has no role.
 */
export function roleOf(row: Pick<ItemListRow, 'isAnchor' | 'anchorKind' | 'status'>): ItemRole | null {
  if (row.isAnchor) return row.anchorKind === 'vertical' ? 'anchor_v' : 'anchor_h';
  if (row.status === 'approved') return 'core';
  if (row.status === 'accepted') return 'pretest';
  return null;
}

const STATUS_TONE: Record<ItemStatus, string> = {
  draft: 'bk-chip--draft',
  in_review: 'chip--warning',
  accepted: 'bk-chip--blue',
  approved: 'chip--success',
  rejected: 'chip--danger',
  retired: 'bk-chip--muted',
};

export function StatusChip({ status, m }: { status: ItemStatus; m: BankMessages }) {
  return <span className={`chip ${STATUS_TONE[status]}`}>{m.status[status]}</span>;
}

export function RoleChip({
  row,
  m,
}: {
  row: Pick<ItemListRow, 'isAnchor' | 'anchorKind' | 'anchorLinkGrade' | 'status'>;
  m: BankMessages;
}) {
  const role = roleOf(row);
  if (!role) {
    return (
      <span className="bk-muted" title={m.roleShort.noneTitle}>
        {m.roleShort.none}
        <span className="visually-hidden">{m.roleShort.noneTitle}</span>
      </span>
    );
  }
  const tone = { core: 'bk-chip--draft', anchor_h: 'chip--monitoring', anchor_v: 'bk-chip--strong', pretest: 'bk-chip--blue' }[role];
  return (
    <span className={`chip ${tone}`} title={m.roleFull[role]}>
      {(role === 'anchor_h' || role === 'anchor_v') && <Icon name="pin" size={14} />}
      {fill(m.roleShort[role], { n: row.anchorLinkGrade ?? '' })}
    </span>
  );
}

/** A 403 from the API: the person is staff but holds no item-bank role. */
export function NoAccess({ m, locale }: { m: BankMessages; locale: Locale }) {
  return (
    <BankState
      icon="lock"
      title={m.noAccess.title}
      body={m.noAccess.body}
      href={`/${locale}/staff`}
      cta={m.noAccess.cta}
    />
  );
}

export function BankState({
  icon = 'inbox',
  title,
  body,
  href,
  cta,
  children,
  as: Heading = 'h1',
}: {
  icon?: IconName;
  title: string;
  body: string;
  href?: string;
  cta?: string;
  children?: React.ReactNode;
  as?: 'h1' | 'h2';
}) {
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name={icon} size={26} />
      </span>
      <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
        <Heading className="state__title">{title}</Heading>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
      </div>
      {(href || children) && (
        <div className="fam-actions">
          {href && cta && (
            <Link href={href} className="fam-btn fam-btn--primary">
              {cta}
            </Link>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- skeletons

export function SkelHead({ button = true }: { button?: boolean }) {
  return (
    <div className="pageHead" aria-hidden="true">
      <div className="fam-stack" style={{ flex: 1 }}>
        <div className="skel" style={{ width: 300, maxWidth: '80%', height: 34 }} />
        <div className="skel" style={{ width: 620, maxWidth: '95%', height: 16 }} />
      </div>
      {button && <div className="skel" style={{ width: 160, height: 48, borderRadius: 999 }} />}
    </div>
  );
}

export function SkelTiles() {
  return (
    <div className="bk-overview" aria-hidden="true">
      <div className="bk-overview__top">
        <div className="fam-stack" style={{ flex: 1 }}>
          <div className="skel" style={{ width: '45%', height: 22 }} />
          <div className="skel" style={{ width: '70%', height: 14 }} />
        </div>
        <div className="skel" style={{ width: 420, maxWidth: '100%', height: 76, borderRadius: 20 }} />
      </div>
      <div className="bk-tiles">
        {[0, 1, 2, 3, 4].map((g) => (
          <div key={g} className="bk-tile">
            <div className="skel" style={{ width: '40%', height: 14 }} />
            <div className="skel" style={{ width: '70%', height: 28 }} />
            <div className="skel" style={{ width: '100%', height: 8 }} />
            <div className="skel" style={{ width: '80%', height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkelTable({ rows = 10, filters = true }: { rows?: number; filters?: boolean }) {
  return (
    <div className="fam-panel" aria-hidden="true">
      {filters && (
        <div className="fam-stack">
          <div className="skel" style={{ width: '70%', height: 44, borderRadius: 999 }} />
          <div className="skel" style={{ width: '55%', height: 32, borderRadius: 999 }} />
          <div className="skel" style={{ width: '60%', height: 32, borderRadius: 999 }} />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bk-skelRow">
          <div className="skel" style={{ width: 96, height: 16 }} />
          <div className="fam-stack" style={{ flex: 1, ['--gap' as string]: '6px' }}>
            <div className="skel" style={{ width: '70%', height: 14 }} />
            <div className="skel" style={{ width: '40%', height: 12 }} />
          </div>
          <div className="skel" style={{ width: 90, height: 26, borderRadius: 999 }} />
          <div className="skel" style={{ width: 100, height: 26, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}
