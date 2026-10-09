import type { CSSProperties } from 'react';

/**
 * Skeleton of the child page: header, the report (hero, then a wide/narrow
 * pair, then a full-width block), then the waves + school panels beside the
 * details panel.
 */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={line(160, 14)} />
      <div className="fp-head">
        <span className="skel" style={{ width: 52, height: 52, borderRadius: '50%' }} />
        <div className="fp-head__body">
          <span className="skel" style={line(260, 34)} />
          <span className="skel" style={line(320, 16)} />
        </div>
      </div>
      <div className="rp">
        <div className="fam-panel rp-hero">
          <div className="rp-hero__lead">
            <span className="skel" style={line(160, 12)} />
            <span className="skel" style={line(240, 52)} />
            <span className="skel" style={line('90%')} />
          </div>
          <div className="rp-hero__scale">
            <span className="skel" style={{ width: '100%', height: 16, borderRadius: 999 }} />
            <span className="skel" style={line('100%', 56)} />
          </div>
        </div>
        <div className="rp-row">
          <div className="fam-panel">
            <span className="skel" style={line('45%', 22)} />
            <div className="fam-inline" style={{ '--gap': '12px', alignItems: 'flex-end' } as CSSProperties}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="skel" style={{ flex: 1, height: 220 }} />
              ))}
            </div>
            <span className="skel" style={line('100%', 56)} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={line('70%', 22)} />
            <span className="skel" style={line('100%', 96)} />
            <span className="skel" style={line('90%')} />
            <span className="skel" style={line('80%')} />
          </div>
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('50%', 22)} />
          <div className="fam-inline" style={{ '--gap': '16px' } as CSSProperties}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ flex: 1, height: 110 }} />
            ))}
          </div>
        </div>
      </div>
      <div className="fam-grid">
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('40%', 20)} />
            {[0, 1].map((i) => (
              <div key={i} className="fam-inline" style={{ '--gap': '14px' } as CSSProperties}>
                <span className="skel" style={{ width: 12, height: 12, borderRadius: '50%' }} />
                <span className="fam-stack" style={{ flex: 1, '--gap': '8px' } as CSSProperties}>
                  <span className="skel" style={line('35%')} />
                  <span className="skel" style={line('60%')} />
                </span>
              </div>
            ))}
            <span className="skel" style={line('100%', 48)} />
          </div>
        </div>
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('40%', 20)} />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skel" style={line('100%', 18)} />
            ))}
          </div>
          <span className="skel" style={{ width: '100%', height: 84, borderRadius: 24 }} />
        </div>
      </div>
    </div>
  );
}
