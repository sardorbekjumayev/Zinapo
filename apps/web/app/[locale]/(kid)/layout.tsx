/**
 * Kid mode (task.md § 7, `(kid)`).
 *
 * Full-screen, no sidebar, no workspace switcher, no language picker, no theme
 * toggle — nothing a child could tap by accident mid-test. It deliberately
 * does NOT use `WorkspaceShell`.
 *
 * The session is launched from a parent's, an educator's or a proctor's
 * account, so the authorisation happens when the session is created
 * (`POST /family/children/:id/sessions`); the player then works off the
 * session id. task.md § 8.3: the whole form is bundled before the start and the
 * page keeps working with no connectivity.
 */
export default function KidLayout({ children }: { children: React.ReactNode }) {
  return <div className="kid">{children}</div>;
}
