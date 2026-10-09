import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import { wizardMessages } from '@/messages/wizard';

/**
 * task.md § 3 / note M2-c: only an owner, or someone with no role yet, may
 * create a child. A co-guardian, educator or staff member lands here instead
 * of on a form that would only fail at the last step.
 */
export function CantAddChild({ locale }: { locale: Locale }) {
  const t = wizardMessages(locale);
  return (
    <section className="state">
      <span className="state__icon state__icon--empty">
        <Icon name="lock" size={26} />
      </span>
      <div className="fam-stack" style={{ ['--gap' as string]: '8px', maxWidth: '62ch' }}>
        <h1 className="state__title">{t.cantTitle}</h1>
        <p className="card__body">{t.cantBody}</p>
        <p className="card__body">{t.cantAsk}</p>
      </div>
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary">
        <Icon name="arrowLeft" size={18} />
        {t.toFamily}
      </Link>
    </section>
  );
}
