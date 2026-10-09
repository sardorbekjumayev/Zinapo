'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bankApi } from '@/lib/bank-api';
import type { Taxonomy } from '@/lib/bank-types';
import type { Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { ItemFields, type ItemFieldErrors, type ItemFieldsValue } from './ItemFields';
import { errorText, needsSkill } from './shared';

/**
 * `/staff/items/new`: only the item-level fields. The API assigns the code
 * and opens v1 as an empty draft, and the author continues on the card.
 */
export function NewItemForm({ tax, m, locale }: { tax: Taxonomy; m: EditorMessages; locale: Locale }) {
  const router = useRouter();
  const [value, setValue] = useState<ItemFieldsValue>({
    grade: null,
    cluster: null,
    topicCode: '',
    skillCode: '',
    construct: '',
  });
  const [errors, setErrors] = useState<ItemFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const alertRef = useRef<HTMLParagraphElement>(null);

  function check(v: ItemFieldsValue): ItemFieldErrors {
    const e: ItemFieldErrors = {};
    if (v.grade === null) e.grade = m.newForm.eGrade;
    if (!v.cluster) e.cluster = m.newForm.eCluster;
    if (!v.topicCode) e.topic = m.newForm.eTopic;
    if (v.grade !== null && needsSkill(v.grade) && !v.skillCode) e.skill = m.newForm.eSkill;
    if (!v.construct.trim()) e.construct = m.newForm.eConstruct;
    return e;
  }

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    const e = check(value);
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length > 0) {
      const first = { grade: 'grade', cluster: 'cluster', topic: 'topic', skill: 'skill', construct: 'construct' }[
        Object.keys(e)[0] as keyof ItemFieldErrors
      ];
      document.querySelector<HTMLElement>(`[name="ie-new-${first}"], #ie-new-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const { id } = await bankApi.createItem({
        grade: value.grade!,
        topicCode: value.topicCode,
        skillCode: needsSkill(value.grade!) ? value.skillCode : undefined,
        construct: value.construct.trim(),
      });
      setStatus(m.newForm.created);
      router.push(`/${locale}/staff/items/${id}`);
    } catch (err) {
      setFailure(errorText(err, m));
      setBusy(false);
      requestAnimationFrame(() => alertRef.current?.focus());
    }
  }

  return (
    <form className="fam-panel" onSubmit={create} noValidate aria-labelledby="ie-new-h">
      <div className="fam-panel__head">
        <h2 id="ie-new-h" className="fam-panel__title">
          {m.card.title}
        </h2>
        <span className="fam-small fam-muted">{m.card.hint}</span>
      </div>

      <ItemFields
        value={value}
        onChange={(v) => {
          setValue(v);
          if (Object.keys(errors).length) setErrors(check(v));
        }}
        tax={tax}
        m={m}
        locale={locale}
        errors={errors}
        idPrefix="ie-new"
      />

      {failure && (
        <p ref={alertRef} tabIndex={-1} className="fam-alert" role="alert">
          {failure}
        </p>
      )}

      <div className="fam-actions">
        <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? m.actions.creating : m.actions.create}
        </button>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
