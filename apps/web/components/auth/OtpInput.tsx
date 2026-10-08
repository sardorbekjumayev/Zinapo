'use client';

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from 'react';

const LENGTH = 5;

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** Fired once the 5th digit lands. */
  onComplete: (code: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Five boxes, paste-aware, `one-time-code` autofill, auto-submits when full. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  invalid,
  disabled,
  autoFocus,
}: Props) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const submitted = useRef<string>('');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === LENGTH && submitted.current !== value) {
      submitted.current = value;
      onComplete(value);
    }
    if (value.length < LENGTH) submitted.current = '';
  }, [value, onComplete]);

  const write = (next: string, focusIndex: number): void => {
    onChange(next.slice(0, LENGTH));
    const target = Math.min(Math.max(focusIndex, 0), LENGTH - 1);
    refs.current[target]?.focus();
    refs.current[target]?.select();
  };

  const handleInput = (index: number, raw: string): void => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;

    // Autofill and paste both deliver several digits into one box.
    if (digits.length > 1) {
      const next = (value.slice(0, index) + digits).slice(0, LENGTH);
      write(next, next.length);
      return;
    }

    const chars = value.padEnd(LENGTH, ' ').split('');
    chars[index] = digits;
    write(chars.join('').trimEnd(), index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        const chars = value.split('');
        chars.splice(index, 1);
        write(chars.join(''), index);
      } else {
        write(value.slice(0, Math.max(0, index - 1)), index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      refs.current[Math.max(0, index - 1)]?.focus();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      refs.current[Math.min(LENGTH - 1, index + 1)]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (digits) write(digits, digits.length);
  };

  return (
    <div className="field">
      <span className="field__label" id="otp-label">
        {label}
      </span>
      <div
        className="otp"
        role="group"
        aria-labelledby="otp-label"
        data-invalid={invalid ? 'true' : 'false'}
      >
        {Array.from({ length: LENGTH }, (_, index) => (
          <input
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            className="otp__box"
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={LENGTH}
            aria-label={`${label} ${index + 1}`}
            aria-invalid={invalid ? 'true' : 'false'}
            value={value[index] ?? ''}
            disabled={disabled}
            onChange={(e) => handleInput(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
    </div>
  );
}
