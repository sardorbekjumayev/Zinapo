import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { FamilyOlympiadView } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';

/**
 * "≥ 3 monitoring waves = direct entry to the spring final" (task.md § 8.1.6).
 * The qualify-top percentage is staff-only, so the other path is described in
 * words ("the best-placed in the spring online stage").
 */
export function TicketCard({
  ticket,
  childName,
  t,
}: {
  ticket: FamilyOlympiadView['ticket'];
  childName: string;
  t: OlympiadMessages;
}) {
  const vars = { name: childName, waves: ticket.waves, needed: ticket.needed };
  const taken = [...ticket.taken].sort((a, b) => a.ordinal - b.ordinal);
  const missing = Math.max(0, ticket.needed - taken.length);

  return (
    <div className={ticket.earned ? 'ol-ticket ol-ticket--earned' : 'ol-ticket'}>
      <span className="ol-ticket__icon" aria-hidden="true">
        <Icon name={ticket.earned ? 'flag' : 'trend'} size={20} />
      </span>
      <div className="ol-ticket__body">
        <span className="card__kicker">{t.ticket.kicker}</span>
        <h3 className="ol-ticket__title">
          {ticket.earned ? t.ticket.earnedTitle : fill(t.ticket.progressTitle, vars)}
        </h3>
        <p className="ol-ticket__text">{fill(ticket.earned ? t.ticket.earnedBody : t.ticket.progressBody, vars)}</p>
        <div className="ol-ticket__waves">
          <span className="ol-ticket__wavesLabel">{t.ticket.waves}</span>
          <ul className="ol-waves">
            {taken.map((w) => (
              <li key={w.ordinal} className="ol-wave ol-wave--on">
                <Icon name="check" size={12} />
                <span aria-hidden="true">{fill(t.ticket.wave, { n: w.ordinal })}</span>
                <span className="visually-hidden">{fill(t.ticket.waveTaken, { n: w.ordinal })}</span>
              </li>
            ))}
            {Array.from({ length: missing }, (_, i) => (
              <li key={`missing-${i}`} className="ol-wave">
                <span className="visually-hidden">{t.ticket.waveMissing}</span>
              </li>
            ))}
          </ul>
          <span className="fam-muted fam-small">{fill(t.ticket.need, vars)}</span>
        </div>
      </div>
    </div>
  );
}
