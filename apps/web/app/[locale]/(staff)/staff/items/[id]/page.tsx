import { ErrorState } from '@/components/family/ErrorState';
import { ItemEditor } from '@/components/staff/editor/ItemEditor';
import { EditorState } from '@/components/staff/editor/States';
import { apiGet } from '@/lib/api-server';
import type { ItemCard, Taxonomy } from '@/lib/bank-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { editorMessages } from '@/messages/editor';

export const dynamic = 'force-dynamic';

/**
 * `/staff/items/[id]` — design/12, the item card (task.md § 8.5). The API
 * decides what this person may do (`can.*`) and hides the key from a reviewer
 * who has not solved the item blind yet (`keysHidden`).
 */
export default async function ItemPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const { locale } = await requireWorkspace(raw, 'staff');
  const m = editorMessages(locale);
  const back = `/${locale}/staff/items`;

  const [item, tax] = await Promise.all([
    apiGet<ItemCard>(`/api/staff/items/${encodeURIComponent(id)}`),
    apiGet<Taxonomy>('/api/staff/taxonomy'),
  ]);

  if ((!item.ok && item.status === 403) || (!tax.ok && tax.status === 403)) {
    return (
      <EditorState
        title={m.states.noAccessTitle}
        body={m.states.noAccessViewBody}
        href={`/${locale}/staff`}
        cta={m.states.back}
      />
    );
  }
  if (!item.ok && item.status === 404) {
    return (
      <EditorState icon="alert" title={m.states.notFoundTitle} body={m.states.notFoundBody} href={back} cta={m.states.back} />
    );
  }
  if (!item.ok || !tax.ok) {
    return (
      <ErrorState
        title={m.states.errTitle}
        body={m.states.errBody}
        retryHref={`${back}/${encodeURIComponent(id)}`}
        retryLabel={m.states.retry}
      />
    );
  }

  return <ItemEditor key={item.data.id} initial={item.data} tax={tax.data} m={m} locale={locale} />;
}
