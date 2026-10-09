'use client';

import type { Topic } from '@/lib/bank-types';
import type { Locale } from '@/lib/i18n';
import type { BankMessages } from '@/messages/bank';

/** Mirrors apps/api/src/bank/dto/taxonomy.dto.ts so a typo is caught before the round trip. */
export const TOPIC_CODE = /^(num|rea|lan)\.[a-z0-9_]{2,30}$/;
export const SKILL_CODE = /^s\.[a-z0-9_]{2,30}(\.[a-z0-9_]{1,30})?$/;
export const MISCONCEPTION_CODE = /^m\.[a-z0-9_]{2,30}(\.[a-z0-9_]{1,30})?$/;
export const PREFIX = { numeracy: 'num.', reasoning: 'rea.', language: 'lan.' } as const;

export interface TaxCopy {
  m: BankMessages;
  locale: Locale;
  canManage: boolean;
}

export function topicName(t: Pick<Topic, 'nameUz' | 'nameRu'>, locale: Locale): string {
  return locale === 'ru' ? t.nameRu : t.nameUz;
}

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  mono,
  invalid,
  multiline,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mono?: boolean;
  invalid?: boolean;
  multiline?: boolean;
  maxLength: number;
}) {
  const common = {
    id,
    value,
    maxLength,
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': hint ? `${id}-hint` : undefined,
  };
  return (
    <div className="fam-field">
      <label className="fam-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          className="fam-input bk-textarea"
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          className={mono ? 'fam-input fam-input--mono bk-input--code' : 'fam-input'}
          autoComplete="off"
          spellCheck={mono ? false : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="fam-caption">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="fam-field">
      <label className="fam-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="fam-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function gradeOptions(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: String(from + i) }));
}

/** Save + cancel row with the busy spinner and the inline error under it. */
export function FormFoot({
  m,
  busy,
  error,
  submitLabel,
  onCancel,
}: {
  m: BankMessages;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onCancel?: () => void;
}) {
  return (
    <>
      {error && (
        <p className="fam-caption fam-caption--bad" role="alert">
          {error}
        </p>
      )}
      <div className="fam-inline">
        <button type="submit" className="fam-btn fam-btn--primary fam-btn--sm" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="fam-btn fam-btn--quiet fam-btn--sm" onClick={onCancel} disabled={busy}>
            {m.common.cancel}
          </button>
        )}
      </div>
    </>
  );
}
