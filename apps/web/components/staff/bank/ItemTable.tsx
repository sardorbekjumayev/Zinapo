import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { ItemListRow } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { BankMessages } from '@/messages/bank';
import { hrefWith, type BankFilters } from './filters';
import { RoleChip, StatusChip } from './parts';

const FLAG_TONE: Record<string, string> = {
  p_out: 'fam-tag--danger',
  low_r: 'fam-tag--danger',
  dead_distractor: 'fam-tag--warn',
  dif: 'fam-tag--warn',
};

function Flags({ row, m }: { row: ItemListRow; m: BankMessages }) {
  // Calibration statistics arrive in M5/M9; until then every row says so.
  if (row.flags.length === 0) {
    return <span className="bk-muted bk-nowrap">{row.stats ? m.table.noFlag : m.table.noStats}</span>;
  }
  const labels = m.flag as Record<string, string>;
  return (
    <span className="bk-flags">
      {row.flags.map((f) => (
        <span key={f} className={`fam-tag ${FLAG_TONE[f] ?? 'fam-tag--warn'}`}>
          {labels[f] ?? f}
        </span>
      ))}
    </span>
  );
}

function Pager({
  base,
  f,
  page,
  pageCount,
  m,
}: {
  base: string;
  f: BankFilters;
  page: number;
  pageCount: number;
  m: BankMessages;
}) {
  const nums = [1, 2, 3, page - 1, page, page + 1, pageCount]
    .filter((n, i, arr) => n >= 1 && n <= pageCount && arr.indexOf(n) === i)
    .sort((a, b) => a - b);
  const href = (n: number) => hrefWith(base, f, { page: n > 1 ? String(n) : undefined });

  return (
    <nav className="bk-pager" aria-label={m.table.pagesLabel}>
      {page > 1 ? (
        <Link href={href(page - 1)} className="bk-pager__btn" aria-label={m.table.prev}>
          <Icon name="arrowLeft" size={18} />
        </Link>
      ) : (
        <span className="bk-pager__btn" aria-hidden="true" data-off="true">
          <Icon name="arrowLeft" size={18} />
        </span>
      )}
      {nums.map((n, i) => (
        <span key={n} className="bk-pager__item">
          {i > 0 && n - nums[i - 1] > 1 && (
            <span className="bk-pager__gap" aria-hidden="true">
              …
            </span>
          )}
          <Link
            href={href(n)}
            className="bk-pager__btn"
            aria-current={n === page ? 'page' : undefined}
            aria-label={fill(m.table.page, { n })}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pageCount ? (
        <Link href={href(page + 1)} className="bk-pager__btn" aria-label={m.table.next}>
          <Icon name="arrowRight" size={18} />
        </Link>
      ) : (
        <span className="bk-pager__btn" aria-hidden="true" data-off="true">
          <Icon name="arrowRight" size={18} />
        </span>
      )}
    </nav>
  );
}

/**
 * design/11 item table. Each row is one link (a stretched link from the code
 * cell) so the whole row opens the item card, while the cells stay a real
 * table for screen readers.
 */
export function ItemTable({
  rows,
  total,
  page,
  perPage,
  showAuthor,
  filtered,
  base,
  f,
  locale,
  m,
}: {
  rows: ItemListRow[];
  total: number;
  page: number;
  perPage: number;
  showAuthor: boolean;
  filtered: boolean;
  base: string;
  f: BankFilters;
  locale: Locale;
  m: BankMessages;
}) {
  const t = m.table;
  const ru = f.lang === 'ru';
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const a = total === 0 ? 0 : (page - 1) * perPage + 1;
  const b = Math.min(page * perPage, total);
  const range = fill(t.range, { a, b, n: total });

  return (
    <>
      <div className="bk-tableWrap">
        <table className="bk-table">
          <caption className="visually-hidden">{t.label}</caption>
          <thead>
            <tr>
              <th scope="col">{t.code}</th>
              <th scope="col">{t.stem}</th>
              <th scope="col">{t.grade}</th>
              <th scope="col">{t.role}</th>
              <th scope="col">{t.status}</th>
              <th scope="col">{t.ver}</th>
              <th scope="col">{t.flags}</th>
              {showAuthor && <th scope="col">{t.author}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const stem = (ru ? row.stemRu : row.stemUz) || (ru ? row.stemUz : row.stemRu);
              const sub = [m.cluster[row.cluster], row.topicCode, row.langs.join(', ')].filter(Boolean).join(' · ');
              return (
                <tr key={row.id} className="bk-row">
                  <td className="bk-row__code">
                    <Link
                      href={`/${locale}/staff/items/${row.id}`}
                      className="bk-rowLink mono"
                      aria-label={fill(t.rowAria, { c: row.code })}
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td className="bk-row__stem">
                    <span className={stem ? 'bk-stem' : 'bk-stem bk-muted'}>{stem || t.noStem}</span>
                    <span className="bk-stem__sub">{sub}</span>
                  </td>
                  <td className="bk-row__num">{row.grade}</td>
                  <td>
                    <RoleChip row={row} m={m} />
                  </td>
                  <td>
                    <StatusChip status={row.status} m={m} />
                  </td>
                  <td className="bk-row__ver">
                    <span className="mono">v{row.version}</span>
                    {row.frozen && (
                      <span className="bk-frozen" title={t.frozen}>
                        <Icon name="lock" size={13} />
                        <span className="visually-hidden">{t.frozen}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <Flags row={row} m={m} />
                  </td>
                  {showAuthor && <td className="bk-row__author">{row.authorName}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bk-tableFoot">
        <div className="fam-stack" style={{ ['--gap' as string]: '6px', flex: 1, minWidth: 0 }}>
          <p className="bk-range" aria-live="polite">
            {filtered ? `${fill(t.rangeF, { n: total })}${pageCount > 1 ? ` · ${range}` : ''}` : range}
          </p>
          <p className="bk-footnote">{t.flagLegend}</p>
        </div>
        {pageCount > 1 && <Pager base={base} f={f} page={page} pageCount={pageCount} m={m} />}
      </div>
    </>
  );
}
