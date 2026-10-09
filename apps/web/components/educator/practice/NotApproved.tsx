import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';

/** The API answers 403 to an educator who is not approved yet (task.md § 2.2). */
export function NotApproved({ locale, m }: { locale: Locale; m: PracticeMessages['common'] }) {
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="lock" size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{m.notApprovedTitle}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {m.notApprovedBody}
        </p>
      </div>
      <Link href={`/${locale}/educator`} className="fam-btn fam-btn--primary">
        {m.toHome}
      </Link>
    </section>
  );
}
