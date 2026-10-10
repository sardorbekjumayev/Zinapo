'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import { isComplete, toE164 } from '@/lib/phone';
import type { AdminMessages } from '@/messages/admin';
import { PhoneField } from './PhoneField';
import { nationalDigits } from './shared';

/** The phone search on /staff/people; the number lives in the URL (`?phone=+998…`) so a lookup can be reloaded or shared. */
export function PeopleSearch({ m, locale, initial }: { m: AdminMessages; locale: Locale; initial: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState(() => nationalDigits(initial));
  const [tried, setTried] = useState(false);
  const [busy, startTransition] = useTransition();
  const invalid = tried && !isComplete(digits);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!isComplete(digits)) return;
    startTransition(() => router.push(`/${locale}/staff/people?phone=${encodeURIComponent(toE164(digits))}`));
  }

  return (
    <form className="ad-search" onSubmit={submit} noValidate role="search">
      <PhoneField id="ad-people-phone" label={m.common.phoneLabel} value={digits} onChange={setDigits} invalid={invalid} errorId="ad-people-phone-err" />
      <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="user" size={18} />}
        {m.people.search}
      </button>
      {invalid && (
        <p id="ad-people-phone-err" className="fam-caption fam-caption--bad ad-search__err" role="alert">
          {m.common.phoneInvalid}
        </p>
      )}
    </form>
  );
}
