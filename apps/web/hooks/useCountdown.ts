'use client';

import { useEffect, useState } from 'react';

function secondsUntil(deadline: string | null): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
}

/**
 * Seconds left until `deadline` (ISO string), ticking once per second.
 *
 * The value is recomputed during render when `deadline` changes rather than in
 * an effect — otherwise the first render after a new code arrives would report
 * 0 and callers would briefly treat a fresh code as expired.
 */
export function useCountdown(deadline: string | null): number {
  const [state, setState] = useState(() => ({ deadline, left: secondsUntil(deadline) }));

  if (state.deadline !== deadline) {
    setState({ deadline, left: secondsUntil(deadline) });
  }

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(
      () => setState({ deadline, left: secondsUntil(deadline) }),
      1000,
    );
    return () => clearInterval(id);
  }, [deadline]);

  return state.deadline === deadline ? state.left : secondsUntil(deadline);
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
