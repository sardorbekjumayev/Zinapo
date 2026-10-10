import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { GrantRoleForm, RevokeRoleButton } from '@/components/staff/admin/RoleActions';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import type { StaffRoles } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatDate } from '@/lib/format';
import { fill, getMessages } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { adminMessages } from '@/messages/admin';

export const dynamic = 'force-dynamic';

/**
 * `/staff/roles` — the super admin's staff role assignments (task.md § 8.5
 * Super admin, § 2.1). Permissions per role are fixed in code; this screen only
 * grants and revokes assignments, which take effect on the next request.
 */
export default async function RolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = adminMessages(locale);
  const r = m.roles;
  const self = `/${locale}/staff/roles`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={r.states.noAccessTitle}
      body={r.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.common.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'role.manage')) return noAccess;

  const res = await apiGet<StaffRoles>('/api/staff/roles');
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return <ErrorState title={r.states.errTitle} body={r.states.errBody} retryHref={self} retryLabel={m.common.retry} />;
  }
  const { roles, people } = res.data;
  const roleNames = getMessages(locale).staffRole as Record<string, string>;

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{r.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {r.subtitle}
            </p>
          </div>
        </div>

        <p className="fam-note fam-note--brand">
          <Icon name="info" size={18} />
          <span>{r.instant}</span>
        </p>

        <div className="ad-rolesLayout">
          <section className="fam-panel" aria-labelledby="ad-holders-title">
            <div>
              <h2 id="ad-holders-title" className="fam-panel__title">
                {r.listTitle}
              </h2>
              <p className="fam-panel__sub">{fill(r.listSubFmt, { n: people.length })}</p>
            </div>
            {people.length === 0 ? (
              <p className="fam-small fam-muted">{r.empty}</p>
            ) : (
              <div className="ad-tableWrap">
                <table className="ad-table ad-table--roles">
                  <thead>
                    <tr>
                      <th scope="col">{r.person}</th>
                      <th scope="col">{r.role}</th>
                      <th scope="col">{r.granted}</th>
                      <th scope="col">
                        <span className="visually-hidden">{r.revoke}</span>
                      </th>
                    </tr>
                  </thead>
                  {people.map((p) => (
                    <tbody key={p.personId}>
                      {p.roles.map((a, i) => {
                        const label = roleNames[a.role] ?? a.role;
                        const when = formatDate(a.grantedAt, locale);
                        return (
                          <tr key={a.assignmentId}>
                            {i === 0 && (
                              <th scope="rowgroup" rowSpan={p.roles.length} className="ad-holder">
                                <span className="ad-holder__name">{p.name}</span>
                                {p.phone && <span className="ad-mono fam-small fam-muted">{p.phone}</span>}
                              </th>
                            )}
                            <td>
                              <span className="fam-tag fam-tag--brand">{label}</span>
                            </td>
                            <td className="fam-small">
                              {a.grantedBy ? fill(r.grantedFmt, { d: when, by: a.grantedBy }) : fill(r.grantedSeed, { d: when })}
                            </td>
                            <td className="ad-table__act">
                              <RevokeRoleButton m={m} assignmentId={a.assignmentId} name={p.name} roleLabel={label} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </section>

          <section className="fam-panel" aria-labelledby="ad-grant-title">
            <div>
              <h2 id="ad-grant-title" className="fam-panel__title">
                {r.grantTitle}
              </h2>
              <p className="fam-panel__sub">{r.grantSub}</p>
            </div>
            <GrantRoleForm m={m} roles={roles} roleNames={roleNames} />
          </section>
        </div>
      </div>
    </LiveRegion>
  );
}
