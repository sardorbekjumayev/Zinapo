import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import type { FamilyOlympiadView, FamilyStage } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';
import { ResultCard } from './ResultCard';
import { StageActions } from './StageActions';
import { StageTimeline } from './StageTimeline';
import { TicketCard } from './TicketCard';
import { byStageOrder, pick, stageDates, STATE_CHIP, whenLine } from './util';

type Olympiad = FamilyOlympiadView['olympiads'][number];

interface Ctx {
  view: FamilyOlympiadView;
  owner: boolean;
  region: string;
  gradeLabel: string;
  childLine: string;
  locale: Locale;
  t: OlympiadMessages;
}

/** One olympiad the child is eligible for (task.md § 8.1.6). Usually there is one. */
export function OlympiadSection({ olympiad, ctx }: { olympiad: Olympiad; ctx: Ctx }) {
  const { locale, t } = ctx;
  const title = pick(locale, olympiad.titleUz, olympiad.titleRu);
  const titleId = `ol-title-${olympiad.id}`;
  const stages = byStageOrder(olympiad.stages);

  return (
    <section className="ol-olympiad" aria-labelledby={titleId}>
      <div className="fam-panel ol-season">
        <div className="ol-season__head">
          <h2 id={titleId} className="fam-panel__title">
            {title}
          </h2>
        </div>
        <StageTimeline
          stages={stages}
          isRanked={olympiad.isRanked}
          locale={locale}
          t={t}
          label={`${t.page.stagesLabel} · ${title}`}
        />
      </div>

      {olympiad.isRanked ? <Ranked olympiad={olympiad} stages={stages} ctx={ctx} /> : <Marathon olympiad={olympiad} stages={stages} ctx={ctx} />}
    </section>
  );
}

function Ranked({ olympiad, stages, ctx }: { olympiad: Olympiad; stages: FamilyStage[]; ctx: Ctx }) {
  const { view, locale, t } = ctx;
  const name = view.child.givenName;
  const hasFinal = stages.some((s) => s.kind === 'spring_final');
  const cup = olympiad.awards.find((a) => a.kind === 'season_cup' && a.place !== null);
  const results = [...stages].reverse().filter((s) => s.entry?.result);
  const panelId = `ol-stages-${olympiad.id}`;

  return (
    <div className="fam-grid">
      <div className="fam-col">
        <section className="fam-panel" aria-labelledby={panelId}>
          <div>
            <h2 id={panelId} className="fam-panel__title">
              {fill(t.page.yourStages, { name })}
            </h2>
            <p className="fam-panel__sub">{t.page.yourStagesSub}</p>
          </div>
          {hasFinal && <TicketCard ticket={view.ticket} childName={name} t={t} />}
          <ul className="ol-stages">
            {stages.map((s) => (
              <StageRow key={s.id} stage={s} olympiad={olympiad} ctx={ctx} />
            ))}
          </ul>
        </section>

        {results.map((s) => (
          <ResultCard
            key={s.id}
            stage={s}
            result={s.entry!.result!}
            isRanked
            certificateTopPct={olympiad.certificateTopPct}
            childName={name}
            region={ctx.region}
            gradeLabel={ctx.gradeLabel}
            place={olympiad.awards.find((a) => a.kind === 'place' && a.stageId === s.id)?.place ?? null}
            locale={locale}
            t={t}
          />
        ))}
      </div>

      <div className="fam-col">
        <CupCard olympiad={olympiad} cupPlace={cup?.place ?? null} ctx={ctx} />
        <PrivacyCard ctx={ctx} />
      </div>
    </div>
  );
}

function StageRow({ stage, olympiad, ctx, marathon = false }: { stage: FamilyStage; olympiad: Olympiad; ctx: Ctx; marathon?: boolean }) {
  const { view, locale, t } = ctx;
  return (
    <li className="ol-stage">
      <div className="ol-stage__head">
        <h3 className="ol-stage__name">{t.stage.name[stage.kind]}</h3>
        <span className={STATE_CHIP[stage.state]}>{t.stage.chip[stage.state]}</span>
      </div>
      <p className="fam-muted fam-small">{marathon ? fill(t.marathon.when, stageDates(stage, locale)) : whenLine(stage, locale, t)}</p>
      <StageActions
        childId={view.child.id}
        childName={view.child.givenName}
        childLine={ctx.childLine}
        olympiadId={olympiad.id}
        stage={stage}
        owner={ctx.owner}
        ownerName={view.owner.name}
        region={ctx.region}
        marathon={marathon}
        locale={locale}
        t={t}
      />
    </li>
  );
}

/** Grades 0–2: design/07's marathon card — no places, no ranking, a skills map. */
function Marathon({ olympiad, stages, ctx }: { olympiad: Olympiad; stages: FamilyStage[]; ctx: Ctx }) {
  const { view, locale, t } = ctx;
  const name = view.child.givenName;
  const panelId = `ol-marathon-${olympiad.id}`;
  return (
    <div className="fam-grid">
      <div className="fam-col">
        <section className="fam-panel" aria-labelledby={panelId}>
          <div className="ol-season__head">
            <div>
              <span className="card__kicker">{ctx.gradeLabel}</span>
              <h2 id={panelId} className="fam-panel__title">
                {fill(t.page.yourStages, { name })}
              </h2>
            </div>
            <span className="fam-tag fam-tag--brand">{t.marathon.chip}</span>
          </div>
          <p className="card__body">{fill(t.marathon.body, { name })}</p>
          <ul className="ol-stages">
            {stages.map((s) => (
              <StageRow key={s.id} stage={s} olympiad={olympiad} ctx={ctx} marathon />
            ))}
          </ul>
          <Link href={`/${locale}/family/children/${view.child.id}`} className="fp-link">
            {fill(t.marathon.report, { name })}
          </Link>
        </section>

        {[...stages].reverse().map((s) =>
          s.entry?.result ? (
            <ResultCard
              key={s.id}
              stage={s}
              result={s.entry.result}
              isRanked={false}
              certificateTopPct={olympiad.certificateTopPct}
              childName={name}
              region={ctx.region}
              gradeLabel={ctx.gradeLabel}
              place={null}
              locale={locale}
              t={t}
            />
          ) : null,
        )}
      </div>
      <div className="fam-col">
        <PrivacyCard ctx={ctx} />
      </div>
    </div>
  );
}

function CupCard({ olympiad, cupPlace, ctx }: { olympiad: Olympiad; cupPlace: number | null; ctx: Ctx }) {
  const { t } = ctx;
  const id = `ol-cup-${olympiad.id}`;
  return (
    <section className="fam-panel ol-cup" aria-labelledby={id}>
      <span className="card__kicker ol-kicker">
        <Icon name="trend" size={14} />
        {t.awards.cupKicker}
      </span>
      <h2 id={id} className="fam-panel__title">
        {t.awards.cupTitle}
      </h2>
      <p className="card__body">{t.awards.cupBody}</p>
      {cupPlace !== null ? (
        <div className="ol-callout ol-callout--ok">
          <span className="ol-callout__icon" aria-hidden="true">
            <Icon name="trophy" size={18} />
          </span>
          <strong>{fill(t.awards.cupWon, { name: ctx.view.child.givenName, n: cupPlace })}</strong>
        </div>
      ) : (
        <p className="fam-muted fam-small">{t.awards.cupNote}</p>
      )}
    </section>
  );
}

function PrivacyCard({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx;
  return (
    <section className="fam-panel" aria-labelledby="ol-privacy">
      <span id="ol-privacy" className="card__kicker">
        {t.privacy.kicker}
      </span>
      <ul className="ol-privacy">
        <li>
          <span className="ol-privacy__icon" aria-hidden="true">
            <Icon name="lock" size={18} />
          </span>
          <div>
            <h3 className="ol-privacy__title">{t.privacy.pv1T}</h3>
            <p className="fam-muted fam-small">{fill(t.privacy.pv1B, { name: ctx.view.child.givenName })}</p>
          </div>
        </li>
        <li>
          <span className="ol-privacy__icon" aria-hidden="true">
            <Icon name="users" size={18} />
          </span>
          <div>
            <h3 className="ol-privacy__title">{t.privacy.pv2T}</h3>
            <p className="fam-muted fam-small">{t.privacy.pv2B}</p>
            <Link href={`/${locale}/family/consents`} className="fam-btn fam-btn--sm ol-privacy__link">
              {t.privacy.link}
            </Link>
          </div>
        </li>
      </ul>
    </section>
  );
}
