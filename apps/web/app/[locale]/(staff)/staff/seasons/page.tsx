import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { NewSchool, SchoolList } from '@/components/staff/seasons/Schools';
import { SeasonsPanel } from '@/components/staff/seasons/SeasonsPanel';
import { GRADES } from '@/components/staff/seasons/shared';
import { WaveCalendar } from '@/components/staff/seasons/WaveCalendar';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { Region } from '@/lib/family-types';
import { regionName } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { Season, StaffSchool, StaffWave, WaveForm } from '@/lib/session-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { seasonsMessages } from '@/messages/seasons';

export const dynamic = 'force-dynamic';

/**
 * `/staff/seasons?season&region&q` — the season manager's screen (task.md
 * § 8.5): seasons, the wave calendar of one season (default: the current
 * one), reminders on open waves, and the schools of a region. Every choice
 * lives in the URL; mutations refresh this server page.
 */
export default async function SeasonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ season?: string; region?: string; q?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const m = seasonsMessages(locale);
  const self = `/${locale}/staff/seasons`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'season.manage')) return noAccess;

  const [seasonsRes, regionsRes] = await Promise.all([
    apiGet<Season[]>('/api/staff/seasons'),
    apiGet<Region[]>('/api/reference/regions'),
  ]);
  if (!seasonsRes.ok && seasonsRes.status === 403) return noAccess;
  const retryHref = `${self}${query(sp)}`;
  const failed = (
    <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={retryHref} retryLabel={m.states.retry} />
  );
  if (!seasonsRes.ok || !regionsRes.ok) return failed;

  const seasons = seasonsRes.data;
  const regions = regionsRes.data;
  const shown = seasons.find((s) => s.id === sp.season) ?? seasons.find((s) => s.isCurrent) ?? seasons[0] ?? null;
  const region = regions.find((r) => String(r.id) === sp.region) ?? null;
  const q = sp.q?.trim().slice(0, 80) || undefined;

  const [wavesRes, schoolsRes, ...formsRes] = await Promise.all([
    shown
      ? apiGet<{ seasonId: string | null; waves: StaffWave[] }>(`/api/staff/waves?seasonId=${shown.id}`)
      : Promise.resolve(null),
    region
      ? apiGet<StaffSchool[]>(`/api/staff/schools?${new URLSearchParams({ regionId: String(region.id), ...(q ? { q } : {}) })}`)
      : Promise.resolve(null),
    ...GRADES.map((g) => apiGet<WaveForm[]>(`/api/staff/waves/forms/${g}`)),
  ]);
  if ((wavesRes && !wavesRes.ok) || (schoolsRes && !schoolsRes.ok) || formsRes.some((r) => !r.ok)) return failed;

  const waves = wavesRes?.ok ? wavesRes.data.waves : [];
  const schools = schoolsRes?.ok ? schoolsRes.data : [];
  const formsByGrade = Object.fromEntries(GRADES.map((g, i) => [g, formsRes[i].ok ? formsRes[i].data : []]));
  const hrefFor = Object.fromEntries(seasons.map((s) => [s.id, `${self}${query({ ...sp, season: s.id })}#ss-cal`]));

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{m.head.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {m.head.subtitle}
            </p>
          </div>
        </div>

        <SeasonsPanel seasons={seasons} shownId={shown?.id ?? null} hrefFor={hrefFor} locale={locale} m={m} />

        <section className="fam-panel" id="ss-cal" aria-labelledby="ss-cal-title">
          {shown ? (
            <>
              <div>
                <h2 id="ss-cal-title" className="fam-panel__title">
                  {fill(m.cal.title, { code: shown.code })}
                </h2>
                <p className="fam-panel__sub">{m.cal.sub}</p>
              </div>
              {!shown.isCurrent && (
                <p className="fam-note fam-note--warn">
                  <Icon name="info" size={18} />
                  <span>{m.cal.notCurrent}</span>
                </p>
              )}
              <WaveCalendar seasonId={shown.id} waves={waves} formsByGrade={formsByGrade} locale={locale} m={m} />
            </>
          ) : (
            <StateBlock icon="calendar" title={m.cal.noSeasonTitle} body={m.cal.noSeasonBody} />
          )}
        </section>

        <section className="fam-panel" id="ss-schools" aria-labelledby="ss-schools-title">
          <div>
            <h2 id="ss-schools-title" className="fam-panel__title">
              {m.schools.title}
            </h2>
            <p className="fam-panel__sub">{m.schools.sub}</p>
          </div>

          <form method="get" action={`${self}#ss-schools`} className="ss-filters" aria-label={m.schools.title}>
            {shown && sp.season && <input type="hidden" name="season" value={shown.id} />}
            <div className="fam-field">
              <label className="fam-label" htmlFor="ss-region">
                {m.schools.regionLbl}
              </label>
              <select id="ss-region" name="region" className="fam-select" defaultValue={region?.id ?? ''}>
                <option value="" disabled>
                  {m.schools.regionChoose}
                </option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {regionName(r, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="fam-field">
              <label className="fam-label" htmlFor="ss-q">
                {m.schools.qLbl}
              </label>
              <input
                id="ss-q"
                name="q"
                type="search"
                className="fam-input"
                defaultValue={q ?? ''}
                maxLength={80}
                placeholder={m.schools.qPh}
              />
            </div>
            <button type="submit" className="fam-btn">
              {m.schools.search}
            </button>
            {q && region && (
              <Link href={`${self}${query({ ...sp, q: undefined })}#ss-schools`} className="fam-btn fam-btn--quiet">
                {m.schools.clear}
              </Link>
            )}
          </form>

          {!region ? (
            <p className="fam-note">
              <Icon name="pin" size={18} />
              <span>
                <strong>{m.schools.chooseTitle}</strong> {m.schools.chooseBody}
              </span>
            </p>
          ) : (
            <>
              <div className="fam-inline" style={{ justifyContent: 'space-between' }}>
                <span className="fam-small fam-muted" aria-live="polite">
                  {regionName(region, locale)} · {fill(m.schools.countFmt, { n: schools.length })}
                </span>
                <NewSchool key={region.id} regionId={region.id} regionName={regionName(region, locale)} m={m} />
              </div>
              {schools.length === 0 ? (
                <p className="fam-note">
                  <Icon name="inbox" size={18} />
                  <span>
                    <strong>{q ? fill(m.schools.emptyQTitle, { q }) : m.schools.emptyTitle}</strong>{' '}
                    {q ? m.schools.emptyQBody : m.schools.emptyBody}
                  </span>
                </p>
              ) : (
                <SchoolList schools={schools} m={m} />
              )}
            </>
          )}
        </section>
      </div>
    </LiveRegion>
  );
}

/** `?season=…&region=…&q=…` without the empty ones. */
function query(sp: { season?: string; region?: string; q?: string }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v);
  return p.size ? `?${p}` : '';
}
