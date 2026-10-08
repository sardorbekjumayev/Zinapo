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
      screen="Application under review"
      milestone="M6 — Educator workspace"
      home={`/${locale}/educator`}
    />
  );
}
