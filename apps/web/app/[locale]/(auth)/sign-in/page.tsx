import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HeroPanel } from '@/components/marketing/HeroPanel';
import { SignInCard } from '@/components/auth/SignInCard';
import { TopControls } from '@/components/shell/TopControls';
import { getMessages, isLocale } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Zinapo — kirish',
};

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function SignInPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const messages = getMessages(locale);
  const query = await searchParams;

  // Invite links carry the inviter's name and their referral code.
  const inviteName = single(query.invite);
  const inviteCode = single(query.code);
  const invite = inviteName && inviteCode ? { name: inviteName, code: inviteCode } : null;

  // `?next=` from middleware or the educator invite landing (/invite/[code] →
  // add-child wizard with the invite). Only a path inside this locale: an open
  // redirect to another site must not ride on a sign-in.
  const rawNext = single(query.next);
  const next =
    rawNext && rawNext.startsWith(`/${locale}/`) && !rawNext.startsWith('//') && !/[\\\s]/.test(rawNext)
      ? rawNext
      : null;

  return (
    <main className="shell">
      <div className="shell__topbar">
        <TopControls locale={locale} themeLabel={messages.themeToggle} />
      </div>
      <div className="shell__grid">
        <HeroPanel messages={messages} />
        <SignInCard locale={locale} messages={messages} invite={invite} next={next} />
      </div>
    </main>
  );
}
