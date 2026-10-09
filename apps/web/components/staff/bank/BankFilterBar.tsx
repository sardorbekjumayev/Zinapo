import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { BankMessages } from '@/messages/bank';
import { CLUSTERS, GRADES, ROLES, STATUSES, anyFilter, hrefWith, type BankFilters } from './filters';

type Opt = { value: string | undefined; label: string };

/** One filter as a row of links; the selected one carries aria-current. */
function Group({
  id,
  label,
  opts,
  current,
  href,
  kind,
}: {
  id: string;
  label: string;
  opts: Opt[];
  current: string | undefined;
  href: (value: string | undefined) => string;
  kind: 'seg' | 'chips';
}) {
  return (
    <div className={kind === 'seg' ? 'bk-fgroup bk-fgroup--seg' : 'bk-fgroup'} role="group" aria-labelledby={id}>
      <span id={id} className="bk-fgroup__label">
        {label}
      </span>
      <div className={kind === 'seg' ? 'bk-seg' : 'bk-chips'}>
        {opts.map((o) => (
          <Link
            key={o.value ?? 'all'}
            href={href(o.value)}
            className={kind === 'seg' ? 'bk-seg__opt' : 'bk-fchip'}
            aria-current={current === o.value ? 'true' : undefined}
            scroll={false}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * design/11 filter block. Every control is a plain link or a GET form, so the
 * filters work without JavaScript and live in the URL.
 */
export function BankFilterBar({ base, f, m }: { base: string; f: BankFilters; m: BankMessages }) {
  const all = m.filters.all;
  const to = (key: keyof BankFilters) => (value: string | undefined) => hrefWith(base, f, { [key]: value });
  // Hidden inputs keep the other filters when the code search is submitted.
  const keep = (['grade', 'cluster', 'status', 'role', 'lang'] as const).filter((k) => f[k]);

  return (
    <div className="bk-filters" role="search" aria-label={m.filters.label}>
      <div className="bk-filters__top">
        <form action={base} method="get" className="bk-search">
          {keep.map((k) => (
            <input key={k} type="hidden" name={k} value={f[k]} />
          ))}
          <label htmlFor="bk-q" className="visually-hidden">
            {m.filters.searchLabel}
          </label>
          {/* The shared icon set has no magnifier; drawn here rather than edit components/shell. */}
          <svg className="bk-search__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id="bk-q"
            name="q"
            type="search"
            className="bk-search__input mono"
            placeholder={m.filters.searchPh}
            defaultValue={f.q ?? ''}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="fam-btn fam-btn--sm bk-search__btn">
            {m.filters.search}
          </button>
        </form>
        <Group
          id="bk-f-grade"
          kind="seg"
          label={m.filters.grade}
          current={f.grade}
          href={to('grade')}
          opts={[{ value: undefined, label: all }, ...GRADES.map((g) => ({ value: String(g), label: String(g) }))]}
        />
        <Group
          id="bk-f-lang"
          kind="seg"
          label={m.filters.lang}
          current={f.lang}
          href={to('lang')}
          opts={[
            { value: undefined, label: all },
            { value: 'uz', label: 'uz' },
            { value: 'ru', label: 'ru' },
          ]}
        />
      </div>
      <Group
        id="bk-f-cluster"
        kind="chips"
        label={m.filters.cluster}
        current={f.cluster}
        href={to('cluster')}
        opts={[{ value: undefined, label: all }, ...CLUSTERS.map((c) => ({ value: c, label: m.cluster[c] }))]}
      />
      <Group
        id="bk-f-status"
        kind="chips"
        label={m.filters.status}
        current={f.status}
        href={to('status')}
        opts={[{ value: undefined, label: all }, ...STATUSES.map((s) => ({ value: s, label: m.status[s] }))]}
      />
      <Group
        id="bk-f-role"
        kind="chips"
        label={m.filters.role}
        current={f.role}
        href={to('role')}
        opts={[{ value: undefined, label: all }, ...ROLES.map((r) => ({ value: r, label: m.roleFull[r] }))]}
      />
      {anyFilter(f) && (
        <div>
          <Link href={base} className="fam-btn fam-btn--quiet fam-btn--sm bk-clear">
            <Icon name="x" size={16} />
            {m.filters.clear}
          </Link>
        </div>
      )}
    </div>
  );
}
