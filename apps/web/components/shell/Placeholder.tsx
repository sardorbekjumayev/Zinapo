import Link from 'next/link';
import { Icon } from './Icon';
import { fill, getMessages, type Locale } from '@/lib/i18n';

/**
 * A route that exists in the shell but whose feature lands in a later
 * milestone (task.md § 12).
 *
 * It is here on purpose rather than left as a 404: the nav rail and the
 * workspace routing are M1 deliverables, and a rail whose links break would
 * not demonstrate them. The screen says plainly which milestone it waits for,
 * so nobody mistakes it for a finished page.
 */
export function Placeholder({
  locale,
  screen,
  milestone,
  home,
}: {
  locale: Locale;
  screen: string;
  /** e.g. "M5 — Measurement v0 & parent reports". */
  milestone: string;
  home: string;
}) {
  const t = getMessages(locale);

  return (
    <>
      <div className="pageHead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.soon.kicker}</span>
          <h1 className="pageHead__title">{fill(t.soon.title, { screen })}</h1>
        </div>
      </div>

      <section className="state">
        <span className="state__icon state__icon--empty">
          <Icon name="clock" size={26} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="state__title">{screen}</h2>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.soon.body}
          </p>
        </div>
        <span className="chip chip--neutral mono">{milestone}</span>
        <Link
          href={home}
          className="onb__cta onb__cta--primary lift"
          style={{ marginTop: 0, textDecoration: 'none' }}
        >
          {t.soon.back}
          <Icon name="arrowRight" size={18} />
        </Link>
      </section>
    </>
  );
}
