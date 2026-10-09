import type { IconName } from './Icon';
import { initialsOf, type Me, type StaffRole } from '@/lib/me';
import type { Messages } from '@/lib/i18n';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  /** Rendered right-aligned, e.g. the number of pupils in a group. */
  count?: string | number;
  /** Initials in a circle instead of an icon — the children in the family rail. */
  avatar?: { text: string; tone: 'brand' | 'teal' | 'blue' };
  /** A second line under the label, e.g. "Grade 4". */
  sub?: string;
}

/** A child as the family rail shows it (design/02, design/06). */
export interface RailChild {
  id: string;
  name: string;
  grade: number | null;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * The nav rail per workspace, from the route list in task.md § 7.
 *
 * The staff rail is filtered by the roles the person actually holds (§ 7:
 * "items depend on staff roles"), so an item author never sees the calibration
 * link at all. That is presentation only — `StaffRoleGuard` on the API is what
 * actually stops them.
 */

const TONES = ['brand', 'teal', 'blue'] as const;

export function familyNav(
  locale: string,
  me: Me,
  t: Messages,
  kids: RailChild[] = [],
): NavGroup[] {
  const base = `/${locale}/family`;
  const count = (me.family?.ownerOf ?? 0) + (me.family?.coGuardianOf ?? 0);

  // design/02 and design/06 list each child by name in the rail. Without the
  // list (it failed to load) the rail falls back to one "Reports" link.
  const childItems: NavItem[] = kids.length
    ? kids.map((kid, i) => ({
        href: `${base}/children/${kid.id}`,
        label: kid.name.split(' ')[0],
        avatar: { text: initialsOf(kid.name), tone: TONES[i % TONES.length] },
        sub: kid.grade === null ? undefined : t.nav.gradeShort.replace('{n}', String(kid.grade)),
      }))
    : [{ href: base, label: t.nav.reports, icon: 'trend', count }];

  return [
    {
      label: t.nav.familyChildren,
      items: [...childItems, { href: `${base}/children/new`, label: t.nav.addChild, icon: 'plus' }],
    },
    {
      label: t.nav.familyManage,
      items: [
        { href: `${base}/access`, label: t.nav.access, icon: 'users' },
        { href: `${base}/consents`, label: t.nav.consents, icon: 'shield' },
        { href: `${base}/privacy`, label: t.nav.privacy, icon: 'lock' },
      ],
    },
  ];
}

/** A teaching group as the educator rail shows it (design/08). */
export interface RailGroup {
  id: string;
  name: string;
  memberCount: number;
}

export function educatorNav(locale: string, me: Me, t: Messages, groups: RailGroup[] = []): NavGroup[] {
  const base = `/${locale}/educator`;

  // design/08 lists each group by name. Without the list (none yet, or it
  // failed to load) the rail falls back to one "Groups" link.
  const groupItems: NavItem[] = groups.length
    ? groups.map((g) => ({ href: `${base}/groups/${g.id}`, label: g.name, icon: 'users', count: g.memberCount }))
    : [{ href: base, label: t.nav.groups, icon: 'users', count: me.educator?.activeChildren ?? 0 }];

  return [
    {
      label: t.nav.educatorGroups,
      items: groupItems,
    },
    {
      label: t.nav.educatorWork,
      items: [
        { href: `${base}/practice`, label: t.nav.practice, icon: 'list' },
        { href: `${base}/invites`, label: t.nav.invites, icon: 'mail' },
        // task.md § 8.4.7: the educator's own children, with the full parent
        // report. Kept separate from the groups so it is obvious they are
        // excluded from the group statistics and the bonus.
        { href: `${base}/my-children`, label: t.nav.myChildren, icon: 'child' },
      ],
    },
  ];
}

/** Which staff roles unlock which rail item (task.md § 2.1 / § 7). */
const STAFF_NAV: { roles: StaffRole[]; key: keyof Messages['nav']; href: string; icon: IconName }[] =
  [
    { roles: ['item_author', 'item_reviewer', 'bank_editor'], key: 'items', href: 'items', icon: 'bank' },
    { roles: ['item_reviewer'], key: 'review', href: 'review', icon: 'check' },
    // M3: everyone who writes or reads items reads the taxonomy; only the bank
    // editor changes it (the page and the API both enforce that).
    { roles: ['item_author', 'item_reviewer', 'bank_editor'], key: 'taxonomy', href: 'taxonomy', icon: 'list' },
    { roles: ['bank_editor'], key: 'forms', href: 'forms', icon: 'file' },
    { roles: ['bank_editor'], key: 'calibration', href: 'calibration', icon: 'gauge' },
    { roles: ['season_manager'], key: 'seasons', href: 'seasons', icon: 'calendar' },
    { roles: ['olympiad_operator'], key: 'olympiads', href: 'olympiads', icon: 'trophy' },
    { roles: ['proctor'], key: 'finals', href: 'finals', icon: 'play' },
    { roles: ['trust_safety'], key: 'cases', href: 'cases', icon: 'flag' },
    { roles: ['outcomes_operator'], key: 'outcomes', href: 'outcomes', icon: 'trend' },
    { roles: ['support', 'trust_safety'], key: 'people', href: 'people', icon: 'user' },
    { roles: ['super_admin'], key: 'roles', href: 'roles', icon: 'settings' },
    { roles: ['super_admin'], key: 'audit', href: 'audit', icon: 'list' },
  ];

export function staffNav(locale: string, me: Me, t: Messages): NavGroup[] {
  const base = `/${locale}/staff`;
  const held = new Set(me.staff?.roles ?? []);

  const items: NavItem[] = STAFF_NAV.filter((entry) =>
    entry.roles.some((role) => held.has(role)),
  ).map((entry) => ({
    href: `${base}/${entry.href}`,
    label: t.nav[entry.key],
    icon: entry.icon,
  }));

  return [
    { items: [{ href: base, label: t.nav.staffHome, icon: 'home' }] },
    { label: t.nav.staffQueues, items },
  ];
}

export function navFor(
  workspace: 'family' | 'educator' | 'staff',
  locale: string,
  me: Me,
  t: Messages,
  kids: RailChild[] = [],
  groups: RailGroup[] = [],
) {
  if (workspace === 'family') return familyNav(locale, me, t, kids);
  if (workspace === 'educator') return educatorNav(locale, me, t, groups);
  return staffNav(locale, me, t);
}
