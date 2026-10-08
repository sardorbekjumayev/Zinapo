import type { IconName } from './Icon';
import type { Me, StaffRole } from '@/lib/me';
import type { Messages } from '@/lib/i18n';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  /** Rendered right-aligned, e.g. the number of pupils in a group. */
  count?: string | number;
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

export function familyNav(locale: string, me: Me, t: Messages): NavGroup[] {
  const base = `/${locale}/family`;
  const children = (me.family?.ownerOf ?? 0) + (me.family?.coGuardianOf ?? 0);

  return [
    {
      label: t.nav.familyChildren,
      items: [
        { href: base, label: t.nav.reports, icon: 'trend', count: children },
        { href: `${base}/children/new`, label: t.nav.addChild, icon: 'plus' },
      ],
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

export function educatorNav(locale: string, me: Me, t: Messages): NavGroup[] {
  const base = `/${locale}/educator`;

  return [
    {
      label: t.nav.educatorGroups,
      items: [
        { href: base, label: t.nav.groups, icon: 'users', count: me.educator?.activeChildren ?? 0 },
      ],
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

export function navFor(workspace: 'family' | 'educator' | 'staff', locale: string, me: Me, t: Messages) {
  if (workspace === 'family') return familyNav(locale, me, t);
  if (workspace === 'educator') return educatorNav(locale, me, t);
  return staffNav(locale, me, t);
}
