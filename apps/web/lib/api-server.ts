import { cookies, headers } from 'next/headers';

const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';

/**
 * A server component's read of the API, with the caller's cookies.
 *
 * Returns `{ ok: false }` rather than throwing so every page can render its
 * error state (task.md § 7.1: "error — what failed plus retry") instead of the
 * framework's error page. `status` lets a page tell "not yours / gone" (404)
 * from "the API is down" (0 / 5xx).
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const cookieHeader = (await cookies()).toString();
  const ua = (await headers()).get('user-agent') ?? '';
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { cookie: cookieHeader, 'user-agent': ua },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}
