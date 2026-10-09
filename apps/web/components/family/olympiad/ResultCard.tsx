import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import type { ClusterStanding, FamilyEntry, FamilyStage } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';
import { pick } from './util';

type Result = NonNullable<FamilyEntry['result']>;

const STANDING_TAG: Record<ClusterStanding, string> = {
  strength: 'fam-tag fam-tag--ok',
  in_line: 'fam-tag',
  weaker: 'fam-tag fam-tag--warn',
};

const SKILL_TAG = { strong: 'fam-tag fam-tag--ok', emerging: 'fam-tag fam-tag--blue', not_yet: 'fam-tag' } as const;

/**
 * One published stage result (task.md § 8.1.6). Only what the family may see:
 * a band (a range, never a point), certificate yes/no, qualification and the
 * diagnostic. No score, no rank, no other child — the API sends none.
 */
export function ResultCard({
  stage,
  result,
  isRanked,
  certificateTopPct,
  childName,
  region,
  gradeLabel,
  place,
  locale,
  t,
}: {
  stage: FamilyStage;
  result: Result;
  isRanked: boolean;
  certificateTopPct: number;
  childName: string;
  region: string;
  gradeLabel: string;
  /** A 1–3 place at the final, when one was awarded. */
  place: number | null;
  locale: Locale;
  t: OlympiadMessages;
}) {
  const stageName = t.stage.name[stage.kind];
  const titleId = `ol-result-${stage.id}`;

  if (!isRanked) {
    // Grades 0–2: no band, no places — a skills map only.
    return (
      <section className="fam-panel ol-result" aria-labelledby={titleId}>
        <span className="card__kicker">{fill(t.result.kicker, { stage: stageName.toUpperCase() })}</span>
        <h2 id={titleId} className="fam-panel__title">
          {t.result.skillsTitle}
        </h2>
        <SkillsMap result={result} locale={locale} t={t} />
      </section>
    );
  }

  const band = result.band;
  const qualifiedCopy =
    stage.kind === 'autumn_online'
      ? { title: t.result.invited, body: t.result.invitedBody }
      : stage.kind === 'spring_online'
        ? { title: t.result.qualified, body: t.result.qualifiedBody }
        : null;

  return (
    <section className="fam-panel ol-result" aria-labelledby={titleId}>
      <span className="card__kicker">{fill(t.result.kicker, { stage: stageName.toUpperCase() })}</span>
      <div className="ol-result__head">
        <h2 id={titleId} className={band ? 'ol-result__band' : 'ol-result__noBand'}>
          {band ? fill(t.result.band, { from: band.top.from, to: band.top.to }) : t.result.noBand}
        </h2>
        <span className="ol-result__sub">{fill(t.result.bandSub, { region, grade: gradeLabel })}</span>
      </div>
      {!band && <p className="fam-muted fam-small">{t.result.noBandBody}</p>}
      <p className="ol-result__note">{stage.inPerson ? t.result.finalNote : t.result.onlineNote}</p>

      {place !== null && (
        <div className="ol-callout ol-callout--ok">
          <span className="ol-callout__icon" aria-hidden="true">
            <Icon name="trophy" size={18} />
          </span>
          <div>
            <strong>{fill(t.awards.placeTitle, { n: place, stage: stageName })}</strong>
            <p>{t.awards.placeBody}</p>
          </div>
        </div>
      )}

      {result.certificate ? (
        <div className="ol-callout ol-callout--ok">
          <span className="ol-callout__icon" aria-hidden="true">
            <Icon name="file" size={18} />
          </span>
          <div>
            <strong>{t.result.certTitle}</strong>
            <p>{fill(t.result.certBody, { name: childName, pct: certificateTopPct, region, grade: gradeLabel })}</p>
          </div>
        </div>
      ) : (
        <div className="ol-callout">
          <span className="ol-callout__icon" aria-hidden="true">
            <Icon name="file" size={18} />
          </span>
          <div>
            <strong>{t.result.noCertTitle}</strong>
            <p>{fill(t.result.noCertBody, { pct: certificateTopPct })}</p>
          </div>
        </div>
      )}

      {result.qualified && qualifiedCopy && (
        <div className="ol-callout ol-callout--brand">
          <span className="ol-callout__icon" aria-hidden="true">
            <Icon name="flag" size={18} />
          </span>
          <div>
            <strong>{qualifiedCopy.title}</strong>
            <p>{fill(qualifiedCopy.body, { name: childName })}</p>
          </div>
        </div>
      )}

      {result.diagnostic?.kind === 'clusters' && (
        <div className="ol-diag">
          <h3 className="ol-diag__title">{t.result.diagTitle}</h3>
          <p className="fam-muted fam-small">{fill(t.result.diagSub, { name: childName })}</p>
          <ul className="ol-diag__rows">
            {(['numeracy', 'reasoning', 'language'] as const).map((c) => {
              const standing = result.diagnostic?.kind === 'clusters' ? result.diagnostic.clusters[c] : undefined;
              if (!standing) return null;
              return (
                <li key={c} className="ol-diag__row">
                  <span className="ol-diag__name">{t.result.cluster[c]}</span>
                  <span className={STANDING_TAG[standing]}>{t.result.standing[standing]}</span>
                </li>
              );
            })}
          </ul>
          <div className="ol-diag__mistake">
            <h4 className="ol-diag__sub">{t.result.mistakeTitle}</h4>
            {result.diagnostic.mistake ? (
              <>
                <strong>{pick(locale, result.diagnostic.mistake.nameUz, result.diagnostic.mistake.nameRu)}</strong>
                <p className="fam-muted fam-small">
                  {pick(locale, result.diagnostic.mistake.explainUz, result.diagnostic.mistake.explainRu)}
                </p>
              </>
            ) : (
              <p className="fam-muted fam-small">{t.result.noMistake}</p>
            )}
          </div>
        </div>
      )}
      {result.diagnostic?.kind === 'skills' && <SkillsMap result={result} locale={locale} t={t} />}
    </section>
  );
}

export function SkillsMap({ result, locale, t }: { result: Result; locale: Locale; t: OlympiadMessages }) {
  const skills = result.diagnostic?.kind === 'skills' ? result.diagnostic.skills : [];
  if (skills.length === 0) return <p className="fam-muted fam-small">{t.result.skillsEmpty}</p>;
  return (
    <ul className="ol-diag__rows">
      {skills.map((s) => (
        <li key={s.code} className="ol-diag__row">
          <span className="ol-diag__name">{pick(locale, s.nameUz, s.nameRu)}</span>
          <span className={SKILL_TAG[s.state]}>{t.result.skill[s.state]}</span>
        </li>
      ))}
    </ul>
  );
}
