import { Messages } from '@/lib/i18n';

/**
 * One monitoring per month. Each entry is the confidence band Zinapo reports —
 * a range, not a point — placed on the track from 0 (bottom) to 1 (top).
 */
const BANDS = [
  { from: 0.12, to: 0.34 },
  { from: 0.26, to: 0.46 },
  { from: 0.4, to: 0.58 },
  { from: 0.52, to: 0.72 },
  { from: 0.58, to: 0.78 },
];

const FEATURE_ICONS = [
  // range
  <svg key="a" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 8h12M5 5v6M11 5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>,
  // growth
  <svg key="b" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 11l4-4 2.5 2.5L13 5m0 0H9.5M13 5v3.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>,
  // next step
  <svg key="c" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8h9m0 0L9 5m3 3-3 3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>,
];

export function HeroPanel({ messages }: { messages: Messages }) {
  const h = messages.hero;

  return (
    <section className="hero">
      <div className="hero__brand">
        <span className="hero__mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M3 14h3v-3h3V8h3V5h3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="hero__brandName">{messages.brand}</span>
      </div>

      <p className="eyebrow">{h.eyebrow}</p>
      <h2 className="hero__title">{h.title}</h2>
      <p className="hero__subtitle">{h.subtitle}</p>

      <div className="sample">
        <div>
          <p className="eyebrow" style={{ marginBottom: 0 }}>
            {h.sampleLabel}
          </p>
          <p className="sample__value">{h.sampleValue}</p>
          <p className="sample__caption">{h.sampleCaption}</p>
          <span className="badge">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2 9l3-3 2 2 3-4m0 0H7.5M10 4v2.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {h.sampleBadge}
          </span>
        </div>

        <div className="spark" role="img" aria-label={`${h.sampleLabel}: ${h.sampleValue}`}>
          {h.months.map((month, index) => {
            const band = BANDS[index] ?? BANDS[0];
            const isLatest = index === BANDS.length - 1;
            return (
              <div className="spark__col" key={month}>
                <div className="spark__track">
                  <span
                    className="spark__fill"
                    style={{
                      bottom: `${band.from * 100}%`,
                      height: `${(band.to - band.from) * 100}%`,
                    }}
                  />
                  {isLatest && (
                    <span
                      className="spark__dot"
                      style={{ bottom: `${((band.from + band.to) / 2) * 100}%` }}
                    />
                  )}
                </div>
                <span className="spark__label">{month}</span>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="features">
        {h.features.map((feature, index) => (
          <li className="feature" key={feature.title}>
            <span className="feature__icon">{FEATURE_ICONS[index]}</span>
            <div>
              <p className="feature__title">{feature.title}</p>
              <p className="feature__body">{feature.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="hero__footnote">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect
            x="2.5"
            y="6"
            width="9"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M4.75 6V4.5a2.25 2.25 0 014.5 0V6" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {h.footnote}
      </p>
    </section>
  );
}
