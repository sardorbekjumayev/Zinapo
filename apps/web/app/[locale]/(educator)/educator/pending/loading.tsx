import type { CSSProperties } from 'react';

/** The pending screen while it loads: head, next steps, the application facts. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
        <span className="skel" style={line(100, 12)} />
        <span className="skel" style={line(340, 34)} />
        <span className="skel" style={line('60%')} />
      </div>
      <div className="iv-top">
        <div className="fam-panel">
          <span className="skel" style={line('40%', 22)} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={line('90%', 20)} />
          ))}
          <span className="skel" style={line('100%', 72)} />
        </div>
        <div className="fam-panel">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={line('80%', 36)} />
          ))}
        </div>
      </div>
    </div>
  );
}
