import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import type { CaseDetail, RuleCode } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { gradeText, when } from './shared';

type Fraud = NonNullable<CaseDetail['fraud']>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Who the flag is about, by rule: an educator, an owner, or one of several people. */
const SUBJECT_ROLE: Record<RuleCode, 'educator' | 'owner' | 'person' | null> = {
  match_check_bursts: 'educator',
  surname_mismatch_group: 'educator',
  owner_never_opens_reports: 'owner',
  many_owners_one_device: 'person',
  olympiad_fast_answers: null,
};

/** "Why this was flagged" + the privacy note (design/15). */
export function WhyPanel({ f, m }: { f: Fraud; m: TrustMessages }) {
  const d = m.detail;
  return (
    <section className="fam-panel" aria-labelledby="ts-why-title">
      <div className="ts-why">
        <h2 id="ts-why-title" className="ts-kicker">
          {d.whyTitle}
        </h2>
        <p className="ts-why__lead">{d.whyBody}</p>
        {f.rule && <p className="ts-why__body">{m.rule[f.rule].why}</p>}
      </div>
      <p className="fam-caption">
        <Icon name="lock" size={14} />
        <span>{d.privacy}</span>
      </p>
    </section>
  );
}

/** The rule's own evidence, in words and short hashes — never a PINFL. */
export function EvidencePanel({ f, locale, m }: { f: Fraud; locale: Locale; m: TrustMessages }) {
  const d = m.detail;
  const ev = f.evidence ?? {};
  const facts: { k: string; v: string; mono?: boolean }[] = [];

  const role = f.rule ? SUBJECT_ROLE[f.rule] : null;
  if (f.subject) {
    facts.push({ k: role ? d.subject[role] : d.subjectT, v: `${f.subject.name}${f.subject.phone ? ` · ${f.subject.phone}` : ''}` });
  }
  if (f.child) {
    facts.push({ k: d.childT, v: `${f.child.name} · ${gradeText(f.child.grade, m)}` });
  }

  switch (f.rule) {
    case 'many_owners_one_device': {
      const dev = (ev.device ?? {}) as Record<string, unknown>;
      if (str(dev.device)) facts.push({ k: d.evDevice, v: str(dev.device)!, mono: true });
      if (str(dev.network)) facts.push({ k: d.evNetwork, v: str(dev.network)!, mono: true });
      if (str(ev.from) && str(ev.to)) {
        facts.push({ k: d.evWindow, v: fill(d.evWindowFmt, { from: when(str(ev.from), locale), to: when(str(ev.to), locale) }) });
      }
      if (num(ev.owners) !== null) facts.push({ k: d.evOwners, v: String(num(ev.owners)) });
      break;
    }
    case 'surname_mismatch_group':
      if (str(ev.groupName)) facts.push({ k: d.evGroup, v: str(ev.groupName)! });
      if (num(ev.surnames) !== null) facts.push({ k: d.evSurnames, v: String(num(ev.surnames)) });
      break;
    case 'owner_never_opens_reports':
      if (num(ev.waves) !== null) facts.push({ k: d.evWaves, v: String(num(ev.waves)) });
      if (num(ev.launchedByOthers) !== null) facts.push({ k: d.evLaunched, v: String(num(ev.launchedByOthers)) });
      break;
    case 'match_check_bursts':
      if (num(ev.maxChecksInAnHour) !== null) facts.push({ k: d.evMaxChecks, v: String(num(ev.maxChecksInAnHour)) });
      if (num(ev.missesIn24h) !== null) facts.push({ k: d.evMisses, v: String(num(ev.missesIn24h)) });
      break;
    case 'olympiad_fast_answers': {
      const ms = num(ev.medianMs);
      const share = num(ev.shareCorrect);
      if (ms !== null) facts.push({ k: d.evMedian, v: fill(d.evMedianFmt, { s: (ms / 1000).toFixed(1) }) });
      if (share !== null) facts.push({ k: d.evShare, v: fill(d.evPctFmt, { n: Math.round(share * 100) }) });
      break;
    }
  }

  return (
    <section className="fam-panel" aria-labelledby="ts-ev-title">
      <h2 id="ts-ev-title" className="fam-panel__title">
        {d.evTitle}
      </h2>
      {facts.length > 0 && (
        <dl className="ts-facts">
          {facts.map((x) => (
            <div key={x.k} className="ts-facts__row">
              <dt>{x.k}</dt>
              <dd className={x.mono ? 'mono' : undefined}>{x.v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(f.evidencePeople.length > 0 || f.evidenceChildren.length > 0) && (
        <div className="ts-twoCol">
          {f.evidencePeople.length > 0 && (
            <div className="ts-box">
              <h3 className="ts-kicker">{d.evPeople}</h3>
              <ul className="ts-names">
                {f.evidencePeople.map((p) => (
                  <li key={p.id}>
                    <Icon name="user" size={16} />
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.evidenceChildren.length > 0 && (
            <div className="ts-box">
              <h3 className="ts-kicker">{d.evChildren}</h3>
              <ul className="ts-names">
                {f.evidenceChildren.map((c) => (
                  <li key={c.id}>
                    <Icon name="child" size={16} />
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The educator card and, once links are paused, each owner's answer. */
export function EducatorPanel({ c, f, locale, m }: { c: CaseDetail; f: Fraud; locale: Locale; m: TrustMessages }) {
  const d = m.detail;
  const e = f.educator;
  if (!e && f.suspendedLinks.length === 0) return null;
  const statusTone: Record<string, string> = { approved: 'fam-tag--ok', suspended: 'fam-tag--danger', applied: 'fam-tag--warn', rejected: 'fam-tag--danger' };
  const answered = f.suspendedLinks.filter((l) => l.ownerResponse !== null).length;
  const answerOf = (r: 'kept' | 'revoked' | null) =>
    r === 'kept' ? { t: d.answer.kept, cls: 'fam-tag--ok' } : r === 'revoked' ? { t: d.answer.ended, cls: 'fam-tag--danger' } : { t: d.answer.waiting, cls: 'fam-tag--warn' };

  return (
    <section className="fam-panel" aria-labelledby="ts-edu-title">
      <h2 id="ts-edu-title" className="fam-panel__title">
        {d.eduT}
      </h2>
      {e && (
        <div className="ts-person">
          <span className="ts-person__icon" aria-hidden="true">
            <Icon name="users" size={20} />
          </span>
          <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <span className="ts-person__name">
              {e.name}
              <span className={`fam-tag ${statusTone[e.status] ?? ''}`}>{(d.eduStatus as Record<string, string>)[e.status] ?? e.status}</span>
            </span>
            <span className="fam-small fam-muted">
              {d.eduCode}: <span className="mono">{e.publicCode}</span> · {d.eduLinks}: {e.activeLinks}
            </span>
          </div>
        </div>
      )}

      {c.status === 'waiting_owner' && (
        <div className="fam-note fam-note--warn">
          <Icon name="clock" size={18} />
          <span>
            <strong>{d.waitT}</strong>
            {d.waitB} {fill(d.waitCount, { c: answered, o: f.suspendedLinks.length })}
          </span>
        </div>
      )}

      {f.suspendedLinks.length > 0 && (
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h3 className="ts-kicker">{d.linksT}</h3>
          <p className="fam-small fam-muted">{d.linksSub}</p>
          <div className="ts-tableWrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th scope="col">{d.linkChild}</th>
                  <th scope="col">{d.linkAnswer}</th>
                  <th scope="col">{d.linkWhen}</th>
                </tr>
              </thead>
              <tbody>
                {f.suspendedLinks.map((l) => {
                  const a = answerOf(l.ownerResponse);
                  return (
                    <tr key={l.id}>
                      <td>{l.childName}</td>
                      <td>
                        <span className={`fam-tag ${a.cls}`}>{a.t}</span>
                      </td>
                      <td className="fam-muted">{when(l.ownerRespondedAt ?? l.suspendedAt, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
