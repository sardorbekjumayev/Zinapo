import type { CSSProperties } from 'react';

/** Skeleton of the child page: header, then report + school panels beside the details panel. */
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
      <div className="fam-grid">
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('30%', 20)} />
            <span className="skel" style={line('90%')} />
            <span className="skel" style={line('70%')} />
          </div>
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
