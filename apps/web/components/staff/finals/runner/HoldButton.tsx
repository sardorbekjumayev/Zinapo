'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';

const HOLD_MS = 2000;

/**
 * The proctor's way out of a child's screen: press and hold, so a child who
 * taps around cannot leave the test or open another child's final. Works with
 * a pointer and with the keyboard (hold Enter or Space).
 */
export function HoldButton({ label, hint, onDone }: { label: string; hint: string; onDone: () => void }) {
  const hintId = useId();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const begin = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      done.current();
    }, HOLD_MS);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <button
      type="button"
      className={holding ? 'fam-btn fn-hold fn-hold--on' : 'fam-btn fn-hold'}
      aria-describedby={hintId}
      style={{ '--fn-hold-ms': `${HOLD_MS}ms` } as React.CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') stop();
      }}
      onBlur={stop}
    >
      <span className="fn-hold__fill" aria-hidden="true" />
      <Icon name="lock" size={18} />
      <span>{label}</span>
      <span id={hintId} className="visually-hidden">
        {hint}
      </span>
    </button>
  );
}
