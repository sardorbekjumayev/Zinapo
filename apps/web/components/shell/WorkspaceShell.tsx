import { Icon } from './Icon';
import { NavRail } from './NavRail';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { navFor } from './nav-items';
import { getMessages, type Locale } from '@/lib/i18n';
import { initialsOf, type Me, type Workspace } from '@/lib/me';

/**
 * The chrome shared by the family, educator and staff workspaces: the nav rail
 * on the left, the header on top, the page in the middle.
 *
 * Kid mode does NOT use this — task.md § 7 wants it full-screen with no
 * sidebar, so `/play/[sessionId]` has its own layout.
 */
export function WorkspaceShell({
  locale,
  me,
  workspace,
  crumb,
  children,
}: {
  locale: Locale;
  me: Me;
  workspace: Workspace;
  /** The breadcrumb line in the header, e.g. "Family · Madina". */
  crumb: string;
  children: React.ReactNode;
}) {
  const t = getMessages(locale);
  const groups = navFor(workspace, locale, me, t);

  const note = noteFor(workspace, me, t);

  return (
    <div className="ws">
      <NavRail
        locale={locale}
        brandLabel={t.brand}
        navLabel={t.nav.label}
        groups={groups}
        note={note}
        signOutLabel={t.nav.profile}
      />

      <main className="ws__main">
        <header className="ws__header">
          <div className="ws__crumb">{crumb}</div>

          {/* Gated here, on the server, as well as inside the component.
              A client component's props are serialised into the HTML even
              when it renders null, so leaving the decision to the client
              would ship the switcher and its labels to every parent who has
              only one workspace — bytes, and a confusing page source. */}
          {me.workspaces.length > 1 && (
            <WorkspaceSwitcher
              locale={locale}
              current={workspace}
              workspaces={me.workspaces}
              labels={t.workspace}
              groupLabel={t.nav.workspaceLabel}
            />
          )}

          <LocaleSwitcher locale={locale} label={t.nav.langLabel} />
          <ThemeToggle label={t.themeToggle} />

          <button type="button" className="ws__iconBtn ghost" aria-label={t.nav.notifications}>
            <Icon name="bell" size={22} />
          </button>

          {/* Decorative: the accessible name for the person is in the crumb. */}
          <span className="ws__avatar" aria-hidden="true">
            {initialsOf(me.person.fullName)}
          </span>
        </header>

        {children}
      </main>
    </div>
  );
}

/**
 * The small card at the bottom of the rail. Each workspace puts the one number
 * there that answers "what is the state of my world" — the design uses it for
 * the educator's access count.
 */
function noteFor(
  workspace: Workspace,
  me: Me,
  t: ReturnType<typeof getMessages>,
): { title: string; body: string } | undefined {
  if (workspace === 'educator') {
    const n = me.educator?.activeChildren ?? 0;
    return { title: t.nav.noteAccess.replace('{n}', String(n)), body: t.nav.noteAccessSub };
  }
  if (workspace === 'family') {
    const n = (me.family?.ownerOf ?? 0) + (me.family?.coGuardianOf ?? 0);
    return { title: t.nav.noteChildren.replace('{n}', String(n)), body: t.nav.noteChildrenSub };
  }
  const roles = me.staff?.roles ?? [];
  return {
    title: t.nav.noteRoles.replace('{n}', String(roles.length)),
    body: roles.map((role) => t.staffRole[role]).join(' · '),
  };
}
