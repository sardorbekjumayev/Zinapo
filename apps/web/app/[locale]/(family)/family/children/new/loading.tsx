/** The wizard's shape while the page loads: title, stepper, form, side card. */
export default function Loading() {
  return (
    <div className="wz" aria-busy="true">
      <div className="fam-stack" style={{ ['--gap' as string]: '10px', padding: '8px 8px 0' }}>
        <div className="skel" style={{ width: 300, maxWidth: '80%', height: 34 }} />
        <div className="skel" style={{ width: 520, maxWidth: '100%', height: 18 }} />
      </div>
      <div className="wz-steps">
        <div className="fam-inline" style={{ ['--gap' as string]: '24px', flexWrap: 'nowrap' }}>
          {[180, 180, 120].map((w, i) => (
            <div key={i} className="fam-inline" style={{ ['--gap' as string]: '12px', flexWrap: 'nowrap' }}>
              <div className="skel" style={{ width: 40, height: 40, borderRadius: 999 }} />
              <div className="skel" style={{ width: w, height: 16 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="fam-grid">
        <section className="fam-panel wz-card">
          <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
            <div className="skel" style={{ width: 160, height: 14 }} />
            <div className="skel" style={{ height: 48, borderRadius: 30 }} />
          </div>
          {[3, 2, 2].map((n, i) => (
            <div key={i} className="fam-row" style={{ ['--cols' as string]: n }}>
              {Array.from({ length: n }, (_, j) => (
                <div key={j} className="skel" style={{ height: 48, borderRadius: 30 }} />
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div className="skel" style={{ width: 180, height: 56, borderRadius: 30 }} />
          </div>
        </section>
        <section className="fam-panel">
          <div className="skel" style={{ width: 180, height: 20 }} />
          <div className="skel" style={{ height: 56 }} />
          <div className="skel" style={{ height: 56 }} />
          <div className="skel" style={{ height: 56 }} />
        </section>
      </div>
    </div>
  );
}
