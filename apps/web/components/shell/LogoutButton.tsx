'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/auth-api';
import type { Locale } from '@/lib/i18n';

export function LogoutButton({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
    } finally {
      router.replace(`/${locale}/sign-in`);
      router.refresh();
    }
  };

  return (
    <button type="button" className="btn btn--primary" onClick={handleClick} disabled={busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {label}
    </button>
  );
}
