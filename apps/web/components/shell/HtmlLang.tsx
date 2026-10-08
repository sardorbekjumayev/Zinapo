'use client';

import { useEffect } from 'react';
import type { Locale } from '@/lib/i18n';

/** `<html lang>` lives in the root layout, which sits above the [locale] segment. */
export function HtmlLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
