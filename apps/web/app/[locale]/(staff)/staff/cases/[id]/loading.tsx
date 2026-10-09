import type { CSSProperties } from 'react';

/** One case while it loads: header card, evidence beside the decision panel. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={line(110, 20)} />
      <div className="fam-panel">
        <span className="skel" style={line(220, 16)} />
        <span className="skel" style={line('45%', 30)} />
        <span className="skel" style={line('30%')} />
      </div>
      <div className="fam-grid">
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('35%', 20)} />
            <span className="skel" style={line('100%', 90)} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={line('25%', 22)} />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skel" style={line('100%', 20)} />
            ))}
          </div>
        </div>
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('40%', 22)} />
            <span className="skel" style={{ height: 56, borderRadius: 999 }} />
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={line('40%', 22)} />
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
