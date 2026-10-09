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

/** Segments that are a workspace, and therefore need the matching claim. */
const WORKSPACES = ['family', 'educator', 'staff'] as const;
type Workspace = (typeof WORKSPACES)[number];

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
 * Reads the `ws` claim out of the access token WITHOUT verifying the signature.
 *
 * That is deliberate and safe here: this decides which shell to render, and
 * nothing more. A forged claim gets someone a sidebar and an immediate bounce
 * from the layout, because `requireWorkspace` re-reads `/api/me` and every data
 * call is authorised again by the API (task.md § 7: "Never trust the client").
 *
 * Verifying properly would mean shipping the JWT secret into the edge runtime
 * for no security gain.
 */
function workspacesFromToken(token: string | undefined): Workspace[] | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { ws?: unknown };
    if (!Array.isArray(json.ws)) return null;
    return json.ws.filter((w): w is Workspace =>
      (WORKSPACES as readonly string[]).includes(w as string),
    );
  } catch {
    return null;
  }
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

  // Workspace segments: bounce to /dashboard, which re-derives the right home
  // from /api/me. Only act on a claim we could actually read — a 15-minute-old
  // access token may be gone while the refresh token is still good, and in that
  // case the layout is the right place to decide.
  if ((WORKSPACES as readonly string[]).includes(page)) {
    const held = workspacesFromToken(accessToken);
    // The one door into a workspace you do not hold yet: onboarding's "add my
    // child" (task.md § 2.2). Only for someone with NO workspace — the API
    // decides whether they may actually create (note M2-c).
    const onboardingAddChild =
      page === 'family' && rest[1] === 'children' && rest[2] === 'new' && held?.length === 0;
    if (held && !held.includes(page as Workspace) && !onboardingAddChild) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url));
    }
  }

  // Layouts cannot see the URL; this lets the family layout recognise the
  // onboarding add-child page without a second route tree.
  const forwarded = new Headers(req.headers);
  forwarded.set('x-zn-path', pathname);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|woff2)$).*)'],
};
