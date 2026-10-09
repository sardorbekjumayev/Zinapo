import Link from 'next/link';
import type { Locale } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';

export type BuilderSource = 'misconception' | 'topic';

/** "From a common mistake" / "By topic" — links, so the choice lives in the URL. */
export function SourceSwitch({
  locale,
  m,
  source,
  groupId,
}: {
  locale: Locale;
  m: PracticeMessages['builder'];
  source: BuilderSource;
  groupId?: string;
}) {
  const href = (s: BuilderSource) =>
    `/${locale}/educator/practice/new?source=${s}${groupId ? `&group=${groupId}` : ''}`;
  return (
    <nav className="pr-switch" aria-label={m.srcLabel}>
      <span className="pr-switch__label">{m.srcLabel}</span>
      <span className="pr-seg">
        {(['misconception', 'topic'] as const).map((s) => (
          <Link
            key={s}
            href={href(s)}
            className={s === source ? 'pr-seg__opt pr-seg__opt--on' : 'pr-seg__opt'}
            aria-current={s === source ? 'page' : undefined}
          >
            {s === 'misconception' ? m.srcMistake : m.srcTopic}
          </Link>
        ))}
      </span>
    </nav>
  );
}
