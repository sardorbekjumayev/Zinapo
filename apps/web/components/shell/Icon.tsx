/**
 * The icon set used by design/*.html: 24×24, stroked, no fills, round caps.
 * Each path is copied from the boards so the app and the design stay in step.
 *
 * A plain lookup rather than one component per icon — these are decoration,
 * and every call site already supplies the accessible name.
 */

export type IconName =
  | 'logo'
  | 'sun'
  | 'moon'
  | 'bell'
  | 'home'
  | 'users'
  | 'user'
  | 'child'
  | 'shield'
  | 'lock'
  | 'trend'
  | 'play'
  | 'list'
  | 'mail'
  | 'signOut'
  | 'trophy'
  | 'flag'
  | 'bank'
  | 'calendar'
  | 'gauge'
  | 'check'
  | 'alert'
  | 'clock'
  | 'arrowRight'
  | 'plus'
  | 'settings'
  | 'file';

const PATHS: Record<IconName, React.ReactNode> = {
  // The staircase — "zinapo" is a step.
  logo: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  home: <path d="M4 11l8-7 8 7v9H4z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.9M17 20v-1a6 6 0 0 0-1.5-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M8 21v-4a4 4 0 0 1 8 0v4M9 13h6" />
    </>
  ),
  shield: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  trend: (
    <>
      <path d="M4 17l5-5 4 3 7-8" />
      <path d="M15 7h5v5" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5z" />
    </>
  ),
  list: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  mail: (
    <>
      <path d="M4 6h16v12H4z" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  signOut: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M10 20h4M12 13v7" />
    </>
  ),
  flag: <path d="M6 4v16M6 5h11l-2 4 2 4H6" />,
  bank: (
    <>
      <path d="M4 10l8-5 8 5" />
      <path d="M6 10v8M18 10v8M10 10v8M14 10v8M4 20h16" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4M16 4v4M4 11h16" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
