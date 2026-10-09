import { notFound } from 'next/navigation';
import { PublicHeader } from '@/components/public/PublicHeader';
import { isLocale } from '@/lib/i18n';

/**
 * Pages anyone may open without a session (task.md § 7: `/invite/[code]`).
 * `middleware.ts` lets them through because their segment is not protected.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }}>
        <PublicHeader locale={locale} home={`/${locale}/sign-in`} />
        {children}
      </main>
    </div>
  );
}
