import { cookies, headers } from 'next/headers';

export type Workspace = 'family' | 'educator' | 'staff';

export type StaffRole =
  | 'item_author'
  | 'item_reviewer'
  | 'bank_editor'
  | 'season_manager'
  | 'olympiad_operator'
  | 'proctor'
  | 'trust_safety'
  | 'support'
  | 'outcomes_operator'
  | 'super_admin';

/** Mirrors `MeResponse` in apps/api/src/me/me.service.ts (task.md § 2.2). */
export interface Me {
  person: { id: string; fullName: string; phone: string; locale: string };
  workspaces: Workspace[];
  family?: { ownerOf: number; coGuardianOf: number };
  educator?: { status: 'applied' | 'approved' | 'rejected' | 'suspended'; activeChildren: number };
  staff?: { roles: StaffRole[]; permissions: string[] };
  lastWorkspace: Workspace | null;
}

const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';

/**
 * Reads `GET /api/me` with the caller's cookies. Returns null when there is no
 * session — callers decide between a redirect to sign-in and rendering a guest
 * view, because those are different pages.
 *
 * Never cached: the whole point is the current person's relationships.
 */
export async function fetchMe(): Promise<Me | null> {
  const cookieHeader = (await cookies()).toString();
  const ua = (await headers()).get('user-agent') ?? '';

  try {
    const res = await fetch(`${API}/api/me`, {
      headers: { cookie: cookieHeader, 'user-agent': ua },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    // The API being down is not "signed out"; the caller shows an error state.
    return null;
  }
}

/** task.md § 2.2 — where `/dashboard` sends someone. */
export function homeFor(me: Me): Workspace | null {
  if (me.workspaces.length === 0) return null;
  if (me.lastWorkspace && me.workspaces.includes(me.lastWorkspace)) return me.lastWorkspace;
  return me.workspaces[0];
}

/** Initials for the header avatar: "Dilnoza Karimova" → "DK". */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function hasStaffRole(me: Me, ...roles: StaffRole[]): boolean {
  return roles.some((role) => me.staff?.roles.includes(role) ?? false);
}

export function hasPermission(me: Me, permission: string): boolean {
  return me.staff?.permissions.includes(permission) ?? false;
}
