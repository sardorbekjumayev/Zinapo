import { cookies, headers } from 'next/headers';
import type { IncomingInvite } from '@/lib/family-types';

const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';

export type InviteLoad =
  | { state: 'ok'; invite: IncomingInvite }
  | { state: 'expired' | 'used' | 'not_found' | 'error' };

/**
 * `GET /family/guardian-invites/:code`. Unlike `apiGet` this needs the error
 * body: "expired" and "used" are different pages from "not for you", and the
 * API only says which in `details.reason` (task.md § 8.2).
 *
 * A wrong phone comes back as `not_found` on purpose — the link must not
 * confirm to a stranger that a child exists behind it.
 */
export async function loadInvite(code: string): Promise<InviteLoad> {
  const cookieHeader = (await cookies()).toString();
  const ua = (await headers()).get('user-agent') ?? '';
  try {
    const res = await fetch(`${API}/api/family/guardian-invites/${encodeURIComponent(code)}`, {
      headers: { cookie: cookieHeader, 'user-agent': ua },
      cache: 'no-store',
    });
    if (res.ok) return { state: 'ok', invite: (await res.json()) as IncomingInvite };
    if (res.status >= 500) return { state: 'error' };
    const body = (await res.json().catch(() => ({}))) as { details?: { reason?: string } };
    const reason = body.details?.reason;
    if (reason === 'expired' || reason === 'used') return { state: reason };
    return { state: 'not_found' };
  } catch {
    return { state: 'error' };
  }
}
