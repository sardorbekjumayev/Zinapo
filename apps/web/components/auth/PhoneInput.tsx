'use client';

import { ChangeEvent, useLayoutEffect, useRef } from 'react';
import {
  UZ_PREFIX,
  caretForDigit,
  digitsBefore,
  digitsOnly,
  formatNational,
} from '@/lib/phone';

interface Props {
  value: string;
  onChange: (digits: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
}

/** `+998` prefix with a "90 312 45 67" mask over exactly 9 digits. */
export function PhoneInput({ value, onChange, label, invalid, disabled, onEnter }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  const formatted = formatNational(value);

  // Re-apply the caret after the mask reflows the string.
  useLayoutEffect(() => {
    if (caretRef.current === null || !inputRef.current) return;
    const position = caretForDigit(formatted, caretRef.current);
    inputRef.current.setSelectionRange(position, position);
    caretRef.current = null;
  }, [formatted]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;
    caretRef.current = digitsBefore(raw, caret);
    onChange(digitsOnly(raw));
  };

  return (
    <div className="field">
      <label className="field__label" htmlFor="phone">
        {label}
      </label>
      <div className="phone" data-invalid={invalid ? 'true' : 'false'}>
        <span className="phone__prefix" aria-hidden="true">
          {UZ_PREFIX}
        </span>
        <input
          id="phone"
          ref={inputRef}
          className="phone__input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="90 312 45 67"
          aria-label={`${label} ${UZ_PREFIX}`}
          aria-invalid={invalid ? 'true' : 'false'}
          value={formatted}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
