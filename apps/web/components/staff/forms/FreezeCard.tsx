'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { bankApi } from '@/lib/bank-api';
import type { FormView } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { formErrorText } from './shared';
import { useFormAction } from './useFormAction';

/**
 * design/14 "Freeze the form" — irreversible (task.md § 8.5), so behind a
 * confirm dialog and only offered once every applicable rule passes (the API
 * refuses otherwise). A frozen form offers "New form from this one" instead.
 */
export function FreezeCard({ form, m, locale }: { form: FormView; m: FormsMessages; locale: Locale }) {
  const router = useRouter();
  const announce = useAnnounce();
  const action = useFormAction(m);
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function freeze() {
    const ok = await action.run('freeze', () => bankApi.freeze(form.id), () => fill(m.freeze.done, { label: form.label }));
    if (ok) setOpen(false);
  }

  async function copy() {
    setCopying(true);
    setCopyError(null);
    try {
      const next = await bankApi.copy(form.id);
      announce(fill(m.freeze.copied, { label: next.label }));
      router.push(`/${locale}/staff/forms/${next.id}`);
    } catch (err) {
      setCopyError(formErrorText(err, m));
      setCopying(false);
    }
  }

  if (form.frozenAt) {
    return (
      <section className="fam-panel" aria-labelledby="fb-freeze-title">
        <h2 id="fb-freeze-title" className="fam-panel__title fb-frozenTitle">
          <Icon name="lock" size={18} />
          {fill(m.freeze.frozenFmt, { date: formatDate(form.frozenAt, locale), name: form.frozenByName ?? '—' })}
        </h2>
        <p className="fam-small fam-muted">{m.freeze.frozenBody}</p>
        {copyError && (
          <p className="fam-alert" role="alert">
            {copyError}
          </p>
        )}
        <button type="button" className="fam-btn fam-btn--primary" disabled={copying} aria-busy={copying} onClick={copy}>
          {copying ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" size={18} />}
          {m.freeze.copy}
        </button>
      </section>
    );
  }

  return (
    <section className="fam-panel" aria-labelledby="fb-freeze-title">
      <h2 id="fb-freeze-title" className="fam-panel__title">
        {m.freeze.title}
      </h2>
      <p className="fam-small fam-muted">{m.freeze.body}</p>
      {!form.canFreeze && (
        <p className="fam-note fam-note--warn" id="fb-freeze-blocked">
          <Icon name="alert" size={18} />
          <span>{m.freeze.blocked}</span>
        </p>
      )}
      {action.errorFor('freeze') && !open && (
        <p className="fam-alert" role="alert">
          {action.errorFor('freeze')}
        </p>
      )}
      <button
        type="button"
        className="fam-btn fam-btn--primary"
        disabled={!form.canFreeze || !!action.busy}
        aria-describedby={!form.canFreeze ? 'fb-freeze-blocked' : undefined}
        onClick={() => setOpen(true)}
      >
        <Icon name="lock" size={18} />
        {m.freeze.btn}
      </button>
      <ConfirmDialog
        open={open}
        icon="lock"
        title={m.freeze.dlgTitle}
        body={
          fill(m.freeze.dlgFmt, { name: form.label, n: form.slots.length }) +
          (form.mode === 'practice' ? m.freeze.dlgPr : m.freeze.dlgMon)
        }
        confirmLabel={m.freeze.confirm}
        cancelLabel={m.freeze.cancel}
        danger={false}
        busy={action.busy === 'freeze'}
        error={action.errorFor('freeze')}
        onConfirm={freeze}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
      />
    </section>
  );
}
