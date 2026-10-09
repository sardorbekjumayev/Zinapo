import type { CSSProperties } from 'react';

/** design/10's shape while the page loads: head, composer + match check, status. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
        <span className="skel" style={line(280, 34)} />
        <span className="skel" style={line('60%', 16)} />
      </div>
      <div className="iv-top">
        <div className="fam-panel">
          <span className="skel" style={line('45%', 22)} />
          <span className="skel" style={line('70%')} />
          <span className="skel" style={{ width: '100%', height: 140, borderRadius: 24 }} />
          <div className="fam-inline" style={{ '--gap': '8px' } as CSSProperties}>
            {[140, 160, 120].map((w) => (
              <span key={w} className="skel" style={{ width: w, height: 28, borderRadius: 999 }} />
            ))}
          </div>
          <span className="skel" style={{ width: '100%', height: 110, borderRadius: 20 }} />
          <span className="skel" style={{ width: 220, height: 52, borderRadius: 999, alignSelf: 'flex-end' }} />
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('70%', 22)} />
          <span className="skel" style={line('90%')} />
          <div className="fam-row">
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
          </div>
          <span className="skel" style={{ height: 48, borderRadius: 999 }} />
          <span className="skel" style={line('100%', 8)} />
          <span className="skel" style={line('80%')} />
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={line('30%', 22)} />
        <div className="iv-status">
          <div className="iv-tiles">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skel" style={{ height: 76, borderRadius: 20 }} />
            ))}
          </div>
          <div className="fam-stack" style={{ '--gap': '14px' } as CSSProperties}>
            <span className="skel" style={line('60%', 32)} />
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="skel" style={line('100%', 40)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
