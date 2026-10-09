'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { ItemCard } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { errorText } from './shared';

type Role = 'core' | 'horizontal' | 'vertical';

const roleOf = (c: ItemCard): Role => (!c.isAnchor ? 'core' : c.anchorKind === 'vertical' ? 'vertical' : 'horizontal');

/**
 * design/12 "Role in forms". Only the bank editor designates anchors, and only
 * on an approved item (task.md § 8.5); everyone else reads it. Vertical
 * anchors link to the grade above, so grade 4 — the top — has none.
 */
export function RolePanel({
  card,
  onCard,
  announce,
  m,
  locale,
}: {
  card: ItemCard;
  onCard: (next: ItemCard) => void;
  announce: (text: string) => void;
  m: EditorMessages;
  locale: Locale;
}) {
  const name = useId();
  const current = roleOf(card);
  const [choice, setChoice] = useState<Role>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = card.can.setAnchor;
  const top = card.grade >= 4;
  const shown = canEdit ? choice : current;

  const roles: [Role, string, string][] = [
    ['core', m.role.core, m.role.coreSub],
    ['horizontal', m.role.h, m.role.hSub],
    ['vertical', m.role.v, m.role.vSub],
  ];

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const next = await bankApi.setAnchor(card.id, choice !== 'core', choice === 'core' ? undefined : choice);
      onCard(next);
      setChoice(roleOf(next));
      announce(m.done.role);
    } catch (err) {
      setError(errorText(err, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fam-panel" aria-labelledby={`${name}-h`}>
      <h2 id={`${name}-h`} className="fam-panel__title">
        {m.role.title}
      </h2>
      <fieldset className="ie-fieldset">
        <legend className="visually-hidden">{m.role.title}</legend>
        <div className="ie-roles">
          {roles.map(([r, title, sub]) => (
            <label key={r} className="ie-role" data-on={shown === r ? 'true' : undefined}>
              <input
                type="radio"
                name={name}
                checked={shown === r}
                disabled={!canEdit || busy || (r === 'vertical' && top)}
                onChange={() => setChoice(r)}
              />
              <span className="ie-role__text">
                <span className="ie-role__title">
                  {r !== 'core' && <Icon name="pin" size={14} />}
                  {title}
                </span>
                <span className="ie-role__sub">{sub}</span>
                {r === 'vertical' &&
                  (top ? (
                    <span className="ie-role__sub ie-role__sub--warn">{m.role.top}</span>
                  ) : (
                    <span className="ie-role__sub">
                      <strong>{fill(m.role.link, { g: card.grade, h: card.grade + 1 })}</strong> ·{' '}
                      {fill(m.role.linkHint, { g: card.grade, h: card.grade + 1 })}
                    </span>
                  ))}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {canEdit ? (
        <div className="fam-actions">
          <button
            type="button"
            className="fam-btn fam-btn--sm"
            disabled={busy || choice === current}
            aria-busy={busy}
            onClick={apply}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {m.role.apply}
          </button>
        </div>
      ) : (
        <p className="fam-small fam-muted">{m.role.onlyEditor}</p>
      )}
      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      <p className={shown !== 'core' ? 'fam-note fam-note--warn' : 'fam-note'}>
        <Icon name="alert" size={18} />
        <span>{m.role.warn}</span>
      </p>

      <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
        <h3 className="ie-kicker">{m.role.usedIn}</h3>
        {card.usedIn.length === 0 ? (
          <p className="fam-small fam-muted">{m.role.usedNone}</p>
        ) : (
          <ul className="ie-used">
            {card.usedIn.map((f) => (
              <li key={`${f.id}:${f.slotRole}`} className="ie-used__row">
                <span className={f.mode === 'practice' ? 'chip chip--practice' : 'chip chip--monitoring'}>
                  {m.role.mode[f.mode]}
                </span>
                <span className="ie-used__label">{f.label}</span>
                <span className="fam-small fam-muted">
                  {m.role.slot[f.slotRole]}
                  {f.frozenAt && ` · ${m.role.frozenForm} ${formatDate(f.frozenAt, locale, false)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
