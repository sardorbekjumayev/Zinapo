import { notFound } from 'next/navigation';
import { Placeholder } from '@/components/shell/Placeholder';
import { isLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <Placeholder
      locale={locale}
      screen="Parent report"
      milestone="M5 — Measurement v0 & parent reports"
      home={`/${locale}/family`}
    />
  );
}
