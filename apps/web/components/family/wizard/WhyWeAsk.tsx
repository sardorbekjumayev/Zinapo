import { Icon, type IconName } from '@/components/shell/Icon';
import type { WizardMessages } from '@/messages/wizard';

/** The side card of design/02: why each thing on the form is asked. */
export function WhyWeAsk({ t }: { t: WizardMessages }) {
  const items: [IconName, string, string][] = [
    ['lock', t.a1t, t.a1b],
    ['pin', t.a2t, t.a2b],
    ['shield', t.a3t, t.a3b],
  ];
  return (
    <aside className="fam-panel wz-why" aria-labelledby="wz-why-title">
      <h2 id="wz-why-title" className="wz-why__title">
        {t.asideTitle}
      </h2>
      {items.map(([icon, title, body]) => (
        <div key={icon} className="wz-why__item">
          <span className="wz-why__icon">
            <Icon name={icon} size={18} />
          </span>
          <div className="wz-why__text">
            <strong>{title}</strong>
            <span>{body}</span>
          </div>
        </div>
      ))}
    </aside>
  );
}
