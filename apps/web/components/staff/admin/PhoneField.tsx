'use client';

import { type ChangeEvent, useLayoutEffect, useRef } from 'react';
import { caretForDigit, digitsBefore, formatNational, UZ_PREFIX } from '@/lib/phone';
import { nationalDigits } from './shared';

/**
 * `+998` and the "90 312 45 67" mask over 9 digits, styled as a staff field
 * (the sign-in `PhoneInput` hard-codes its id and auth styling). A pasted full
 * number ("+998 90 …") lands on the same 9 digits.
 */
export function PhoneField({
  id,
  label,
  value,
  onChange,
  invalid = false,
  errorId,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
  invalid?: boolean;
  /** The id of the error caption, linked while `invalid`. */
  errorId?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const formatted = formatNational(value);

  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return;
    const at = caretForDigit(formatted, caret.current);
    ref.current.setSelectionRange(at, at);
    caret.current = null;
  }, [formatted]);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const pasted = raw.replace(/\D/g, '').length > 9;
    caret.current = pasted ? null : digitsBefore(raw, e.target.selectionStart ?? raw.length);
    onChange(nationalDigits(raw));
  }

  return (
    <div className="fam-field">
      <label className="fam-label" htmlFor={id}>
        {label}
      </label>
      <div className="ad-phone" data-invalid={invalid ? 'true' : 'false'}>
        <span className="ad-phone__prefix" aria-hidden="true">
          {UZ_PREFIX}
        </span>
        <input
          id={id}
          ref={ref}
          className="ad-phone__input"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="90 123 45 67"
          value={formatted}
          onChange={handle}
          disabled={disabled}
          aria-invalid={invalid ? 'true' : 'false'}
          aria-describedby={invalid && errorId ? errorId : undefined}
        />
      </div>
    </div>
  );
}
