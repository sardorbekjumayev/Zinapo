'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import type { Misconception } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { pick } from './labels';

/**
 * "Common mistakes this wave" (design/08): the API's top 4, each with how many
 * of the children who took the wave picked it. Choosing one leads to the
 * practice builder — practice mode never touches a child's position (§ 8.4.5).
 */
export function MistakesPanel({
  locale,
  items,
  took,
  groupId,
  waveId,
}: {
  locale: Locale;
  items: Misconception[];
  took: number;
  groupId: string;
  waveId: string | null;
}) {
  const m = educatorMessages(locale);
  const g = m.group;
  const [code, setCode] = useState(items[0]?.code ?? '');

  if (items.length === 0) {
    return (
      <p className="fam-note">
        <Icon name="info" size={18} />
        {g.mEmpty}
      </p>
    );
  }

  const q = new URLSearchParams({ source: 'misconception', code, group: groupId });
  if (waveId) q.set('wave', waveId);
  // The bar's base: children who took the wave; never below the largest count.
  const base = Math.max(took, ...items.map((i) => i.childCount), 1);

  return (
    <>
      <fieldset className="ed-mistakes">
        <legend className="visually-hidden">{g.mTitle}</legend>
        {items.map((it) => (
          <label key={it.code} className="ed-mistake">
            <input
              type="radio"
              name="ed-mistake"
              value={it.code}
              checked={code === it.code}
              onChange={() => setCode(it.code)}
              className="visually-hidden"
            />
            <span className="ed-mistake__top">
              <span className="ed-mistake__name">{pick(locale, it.nameUz, it.nameRu)}</span>
              <span className="ed-mistake__count">{fill(g.mCount, { n: it.childCount, m: base })}</span>
            </span>
            <span className="ed-mistake__bar" aria-hidden="true">
              <span className="ed-mistake__fill" style={{ '--fill': it.childCount / base } as React.CSSProperties} />
            </span>
            <span className="fam-muted fam-small">
              {pick(locale, it.topic.nameUz, it.topic.nameRu)} · {pick(locale, it.explainUz, it.explainRu)}
            </span>
          </label>
        ))}
      </fieldset>
      <Link href={`/${locale}/educator/practice/new?${q.toString()}`} className="fam-btn ed-btnPractice">
        {g.mCta}
        <Icon name="arrowRight" size={18} />
      </Link>
      <p className="fam-caption ed-center">{g.mCtaNote}</p>
    </>
  );
}
