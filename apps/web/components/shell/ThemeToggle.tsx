'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Theme = 'light' | 'dark';
const THEME_KEY = 'zn_theme';

/**
 * Light/dark, with the Lumen tokens on both sides (task.md § 7.1).
 *
 * The inline script in app/layout.tsx has already set `data-theme` before
 * paint, so this only reads it back and lets the person override. The icon
 * shows the CURRENT theme, matching design/08-teacher-cabinet.html.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as Theme) ?? 'light');
  }, []);

  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the OS preference still applies on the next load.
    }
  };

  return (
    <button
      type="button"
      className="ws__iconBtn ghost"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === 'dark'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} />
    </button>
  );
}
