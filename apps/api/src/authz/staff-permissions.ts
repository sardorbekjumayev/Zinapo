/**
 * Staff permissions are a constant map in code (task.md § 4). The database
 * stores only *assignments* — which person holds which role — so changing what
 * a role may do is a code review, not a data edit.
 *
 * A person may hold several staff roles; their permissions are the union.
 */

import { StaffRole } from './actor';

export const PERMISSIONS = [
  // Item bank
  'item.create',          // write a draft item to the template
  'item.read.own',        // see only your own items and their statistics
  'item.read.all',
  'item.review',          // two-hand review: blind solve, then critique
  'item.approve',         // approve / retire, designate anchors
  'item.statistics',
  'taxonomy.manage',      // topics, skills, misconceptions (M3, note M3-d)
  // Forms and calibration
  'form.build',
  'form.freeze',
  'calibration.run',
  // Seasons
  'season.manage',
  'reminder.bulk',
  // Olympiads
  'olympiad.manage',
  'olympiad.results',
  'final.proctor',
  // Trust & safety
  'case.read',
  'case.resolve',
  'educator.decide',      // approve or reject an educator application
  'link.suspend',
  // Support
  'person.lookup',        // by phone: relationships and statuses, never PINFL
  'invite.resend',
  'login.reset',
  // Outcomes
  'outcome.import',
  // Admin
  'role.manage',
  'audit.read',
  'settings.manage',
  'anonymisation.execute',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * task.md § 2.1, one row per staff role.
 *
 * Note what is deliberately absent everywhere: nobody can read a PINFL
 * (INV-06), nobody can create a child (only an owner can), and `super_admin`
 * does NOT inherit the other roles — task.md § 2.1: "everything else needs the
 * specific role too".
 */
export const STAFF_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  item_author: ['item.create', 'item.read.own'],

  item_reviewer: ['item.review', 'item.read.all'],

  bank_editor: [
    'item.read.all',
    'item.approve',
    'item.statistics',
    'taxonomy.manage',
    'form.build',
    'form.freeze',
    'calibration.run',
  ],

  season_manager: ['season.manage', 'reminder.bulk'],

  olympiad_operator: ['olympiad.manage', 'olympiad.results'],

  proctor: ['final.proctor'],

  trust_safety: ['case.read', 'case.resolve', 'educator.decide', 'link.suspend', 'person.lookup'],

  support: ['person.lookup', 'invite.resend', 'login.reset'],

  outcomes_operator: ['outcome.import'],

  super_admin: ['role.manage', 'audit.read', 'settings.manage', 'anonymisation.execute'],
};

export function permissionsOf(roles: readonly StaffRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    for (const permission of STAFF_PERMISSIONS[role]) out.add(permission);
  }
  return out;
}

export function hasPermission(roles: readonly StaffRole[], permission: Permission): boolean {
  return roles.some((role) => STAFF_PERMISSIONS[role].includes(permission));
}
