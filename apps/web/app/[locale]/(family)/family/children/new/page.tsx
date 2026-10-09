import { ErrorState } from '@/components/family/ErrorState';
import { AddChildWizard } from '@/components/family/wizard/AddChildWizard';
import { CantAddChild } from '@/components/family/wizard/CantAddChild';
import { currentSchoolYear } from '@/components/family/wizard/pinfl';
import { apiGet } from '@/lib/api-server';
import type { InvitePreview, Region } from '@/lib/family-types';
import { familyMessages } from '@/messages/family';
import { wizardMessages } from '@/messages/wizard';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/**
 * `/family/children/new` — the add-child wizard (task.md § 8.1.2,
 * design/02-add-child.html).
 *
 * A brand-new person with no role arrives here from onboarding, so the
 * workspace check lets them through. Whether they may add a child at all is
 * the API's call (`can-create`); asking first means a co-guardian sees why
 * not, instead of filling a form that fails on submit.
 *
 * `?invite=CODE` comes from an educator's SMS. An unknown or expired code just
 * means no banner — the parent can still add the child on their own.
 */
export default async function AddChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'family', { allowNoWorkspace: true });
  const t = wizardMessages(locale);
  const fam = familyMessages(locale);
  const retryHref = `/${locale}/family/children/new`;

  const can = await apiGet<{ canCreate: boolean }>('/api/family/children/can-create');
  if (!can.ok) {
    return (
      <ErrorState
        title={t.loadErrTitle}
        body={fam.common.networkError}
        retryHref={retryHref}
        retryLabel={fam.common.retry}
      />
    );
  }
  if (!can.data.canCreate) return <CantAddChild locale={locale} />;

  const { invite: rawInvite } = await searchParams;
  const code = typeof rawInvite === 'string' ? rawInvite.trim() : '';
  const [regions, preview] = await Promise.all([
    apiGet<Region[]>('/api/reference/regions'),
    code ? apiGet<InvitePreview>(`/api/family/educator-invites/${encodeURIComponent(code)}`) : null,
  ]);
  if (!regions.ok || regions.data.length === 0) {
    return (
      <ErrorState
        title={t.loadErrTitle}
        body={t.loadErrBody}
        retryHref={code ? `${retryHref}?invite=${encodeURIComponent(code)}` : retryHref}
        retryLabel={fam.common.retry}
      />
    );
  }

  return (
    <AddChildWizard
      locale={locale}
      regions={regions.data}
      invite={preview?.ok ? { ...preview.data, code } : null}
      ownerName={me.person.fullName}
      schoolYear={currentSchoolYear()}
      forbidden={<CantAddChild locale={locale} />}
    />
  );
}
