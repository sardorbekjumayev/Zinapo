import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { NewItemForm } from '@/components/staff/editor/NewItemForm';
import { EditorState } from '@/components/staff/editor/States';
import { apiGet } from '@/lib/api-server';
import type { Taxonomy } from '@/lib/bank-types';
import { hasStaffRole } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { editorMessages } from '@/messages/editor';

export const dynamic = 'force-dynamic';

/**
 * `/staff/items/new` — design/12 blank state: the item-level fields only.
 * Item authors and the bank editor write items (task.md § 8.5); anyone else
 * gets a clear "no access", which the API would answer with 403 anyway.
 */
export default async function NewItemPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = editorMessages(locale);
  const back = `/${locale}/staff/items`;

  const noAccess = (
    <EditorState title={m.states.noAccessTitle} body={m.states.noAccessBody} href={`/${locale}/staff`} cta={m.states.back} />
  );
  if (!hasStaffRole(me, 'item_author', 'bank_editor')) return noAccess;

  const tax = await apiGet<Taxonomy>('/api/staff/taxonomy');
  if (!tax.ok) {
    if (tax.status === 403) return noAccess;
    return (
      <ErrorState
        title={m.states.errTitle}
        body={m.states.errBody}
        retryHref={`${back}/new`}
        retryLabel={m.states.retry}
      />
    );
  }

  return (
    <div className="fam-stack ie" style={{ ['--gap' as string]: '24px' }}>
      <nav className="ie-crumb" aria-label={m.crumbBack}>
        <Link href={back} className="ie-crumb__back">
          <span aria-hidden="true">‹</span> {m.crumbBack}
        </Link>
      </nav>
      <header className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <h1 className="pageHead__title">{m.newTitle}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.newSub}
          </p>
        </div>
      </header>
      <div className="fam-grid">
        <div className="fam-col">
          <NewItemForm tax={tax.data} m={m} locale={locale} />
        </div>
        <div className="fam-col">
          <section className="fam-panel ie-pay" aria-labelledby="ie-pay-h">
            <div className="fam-stack" style={{ ['--gap' as string]: '6px' }}>
              <h2 id="ie-pay-h" className="ie-pay__title">
                {m.pay.title}
              </h2>
              <p className="fam-small fam-muted">{m.pay.body}</p>
            </div>
          </section>
          <p className="fam-note">
            <span>{m.hist.note}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
