import { NextRequest, NextResponse } from 'next/server';

const LOCALES = ['uz', 'ru', 'en', 'kaa'] as const;
const DEFAULT_LOCALE = 'uz';

const SIGN_IN = 'sign-in';

/** Anything under these needs a session (task.md § 7). */
const PROTECTED = [
  'dashboard',
  'onboarding',
  'profile',
  'family',
  'educator',
  'staff',
  'play',
  'guardian-invite',
];

function pickLocale(req: NextRequest): string {
  const cookie = req.cookies.get('zn_locale')?.value;
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) return cookie;

  const header = req.headers.get('accept-language') ?? '';
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().slice(0, 2).toLowerCase();
    if (tag === 'ru') return 'ru';
    if (tag === 'en') return 'en';
    if (tag === 'uz') return 'uz';
  }
  return DEFAULT_LOCALE;
}

/**
 * Locale prefixing, the auth redirects from the sign-in spec § 8, and the
 * workspace gate from task.md § 7.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const segments = pathname.split('/').filter(Boolean);
  const hasLocale = (LOCALES as readonly string[]).includes(segments[0] ?? '');

  if (!hasLocale) {
    const locale = pickLocale(req);
    const rest = segments.length ? `/${segments.join('/')}` : `/${SIGN_IN}`;
    return NextResponse.redirect(new URL(`/${locale}${rest}${search}`, req.url));
  }

  const [locale, ...rest] = segments;
  const page = rest[0] ?? '';

  // zn_at lives 15 min, zn_rt 30 days — either one means "has a session".
  const accessToken = req.cookies.get('zn_at')?.value;
  const signedIn = Boolean(accessToken || req.cookies.get('zn_rt'));

  if (!signedIn && PROTECTED.includes(page)) {
    const next = encodeURIComponent(`${pathname}${search}`);
    return NextResponse.redirect(new URL(`/${locale}/${SIGN_IN}?next=${next}`, req.url));
  }
  if (signedIn && (page === SIGN_IN || page === '')) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
  }
  if (page === '') {
    return NextResponse.redirect(new URL(`/${locale}/${SIGN_IN}`, req.url));
  }

  // Workspace segments are NOT gated here. The `ws` claim in the access token
  // is a snapshot up to 15 minutes old, and bouncing on it looped forever when
  // it disagreed with the live relationships: a parent whose token predated
  // their first child went /family → /dashboard → /family … (found in M4).
  // Each workspace layout checks `/api/me` on every request
  // (`requireWorkspace`), and the API authorises every data call again (§ 7).

  // Layouts cannot see the URL; this lets the family layout recognise the
  // onboarding add-child page without a second route tree.
  const forwarded = new Headers(req.headers);
  forwarded.set('x-zn-path', pathname);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|woff2)$).*)'],
};
