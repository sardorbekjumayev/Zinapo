/**
 * The Actor — who is making this request, as relationships rather than a type.
 *
 * task.md § 1.1 / INV-01: there is one `person` table and no `person.role`.
 * Roles are derived at request time from the relationships that exist, so the
 * Actor is a *projection*, never something stored.
 *
 * It is loaded once per request and cached in Redis for 60 s (task.md § 4).
 * Anything that changes a relationship invalidates the cache explicitly —
 * granting a staff role or approving an educator must take effect now, not in
 * up to a minute.
 */

export const STAFF_ROLES = [
  'item_author',
  'item_reviewer',
  'bank_editor',
  'season_manager',
  'olympiad_operator',
  'proctor',
  'trust_safety',
  'support',
  'outcomes_operator',
  'super_admin',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type EducatorStatus = 'applied' | 'approved' | 'rejected' | 'suspended';

export type Workspace = 'family' | 'educator' | 'staff';

export interface Actor {
  personId: string;
  staffRoles: StaffRole[];
  /** null when this person has never applied as an educator. */
  educatorStatus: EducatorStatus | null;
  /** Children this person owns (`guardianship.role = 'owner'`). */
  ownerOf: number;
  /** Children this person co-guards. */
  coGuardianOf: number;
  lastWorkspace: Workspace | null;
}

/**
 * The workspaces this actor may enter. task.md § 2.2:
 *   family   — holds any live guardianship, as owner or co-guardian
 *   educator — has an educator_profile at all; `applied` lands on /educator/pending
 *   staff    — holds at least one live staff role
 */
export function workspacesOf(actor: Actor): Workspace[] {
  const out: Workspace[] = [];
  if (actor.ownerOf > 0 || actor.coGuardianOf > 0) out.push('family');
  // An applied-but-undecided educator still has the workspace; it renders the
  // pending screen. A rejected or suspended one does not.
  if (actor.educatorStatus === 'applied' || actor.educatorStatus === 'approved') {
    out.push('educator');
  }
  if (actor.staffRoles.length > 0) out.push('staff');
  return out;
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** Request-scoped home for the loaded Actor. */
export const ACTOR_KEY = 'znActor';
