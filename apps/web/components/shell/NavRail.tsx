'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import type { NavGroup } from './nav-items';

/**
 * The 264px rail from design/08-teacher-cabinet.html.
 *
 * A client component only because `aria-current` needs the live pathname;
 * everything it renders is passed in from the server layout.
 */
export function NavRail({
  locale,
  brandLabel,
  groups,
  note,
  signOutLabel,
  navLabel,
}: {
  locale: string;
  brandLabel: string;
  groups: NavGroup[];
  note?: { title: string; body: string };
  signOutLabel: string;
  navLabel: string;
}) {
  const pathname = usePathname();

  // Longest match wins, so `/family/access` does not also light up `/family`.
  const activeHref = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="ws__nav" aria-label={navLabel}>
      <Link href={`/${locale}/dashboard`} className="ws__brand" aria-label={brandLabel}>
        <span className="ws__brandMark">
          <Icon name="logo" size={22} strokeWidth={2} />
        </span>
        <span className="ws__brandName">{brandLabel}</span>
      </Link>

      {groups.map((group, index) => (
        <div className="ws__group" key={group.label ?? index}>
          {group.label && <div className="ws__groupLabel">{group.label}</div>}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.href === activeHref ? 'ws__link' : 'ws__link ghost'}
              aria-current={item.href === activeHref ? 'page' : undefined}
            >
              {item.icon && <Icon name={item.icon} />}
              <span>{item.label}</span>
              {item.count !== undefined && <span className="ws__linkCount">{item.count}</span>}
            </Link>
          ))}
        </div>
      ))}

      {note && (
        <div className="ws__note">
          <span className="ws__noteTitle">{note.title}</span>
          <span className="ws__noteBody">{note.body}</span>
        </div>
      )}

      <div className="ws__group ws__navFoot">
        <Link href={`/${locale}/profile`} className="ws__link ghost">
          <Icon name="settings" />
          <span>{signOutLabel}</span>
        </Link>
      </div>
    </nav>
  );
}
