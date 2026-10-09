'use client';

import { useEffect } from 'react';

/**
 * Deep-link attribution (task.md § 8.1.6): the landing's `?src=` is kept for
 * 30 days so the registration made later, after sign-in, can send it as
 * `source`. First-party, Lax, nothing personal in it.
 */
export function SrcCookie({ src }: { src: string }) {
  useEffect(() => {
    document.cookie = `zn_src=${encodeURIComponent(src)}; Max-Age=${30 * 24 * 3600}; Path=/; SameSite=Lax`;
  }, [src]);
  return null;
}
