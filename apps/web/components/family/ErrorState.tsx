import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';

/**
 * task.md § 7.1: "error — what failed plus retry". Retry is a plain link to
 * the same page: a server-rendered screen re-fetches on navigation, and it
 * works without JavaScript.
 */
export function ErrorState({
  title,
  body,
  retryHref,
  retryLabel,
}: {
  title: string;
  body: string;
  retryHref: string;
  retryLabel: string;
}) {
  return (
    <section className="state" role="alert">
      <span className="state__icon state__icon--error">
        <Icon name="alert" size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{title}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
      </div>
      <Link href={retryHref} className="fam-btn fam-btn--primary">
        {retryLabel}
      </Link>
    </section>
  );
}
