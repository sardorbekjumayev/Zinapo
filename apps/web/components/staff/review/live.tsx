'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const Announce = createContext<(text: string) => void>(() => {});

/**
 * One polite live region per staff page (review and form builder), so the
 * result of every mutation is read out once (task.md § 7.1). Also shown as a
 * short-lived toast: after a refresh or a move to the next item, the thing
 * that was acted on is often no longer on screen.
 */
export function LiveRegion({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    // Clear first so the same sentence twice in a row is still announced.
    setText('');
    requestAnimationFrame(() => setText(next));
    timer.current = setTimeout(() => setText(''), 7000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Announce.Provider value={announce}>
      {children}
      <div className="rv-toast" role="status" aria-live="polite" data-shown={text ? 'true' : 'false'}>
        {text}
      </div>
    </Announce.Provider>
  );
}

export function useAnnounce() {
  return useContext(Announce);
}
