import type { CSSProperties } from 'react';

/** The invitation card while it loads: title, tags, three steps, the button. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-panel" aria-busy="true">
      <span className="skel" style={line(100, 12)} />
      <span className="skel" style={line('80%', 34)} />
      <span className="skel" style={line(260, 24)} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="fam-inline" style={{ '--gap': '14px' } as CSSProperties}>
          <span className="skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <span className="fam-stack" style={{ flex: 1, '--gap': '8px' } as CSSProperties}>
            <span className="skel" style={line('40%')} />
            <span className="skel" style={line('70%')} />
          </span>
        </div>
      ))}
      <span className="skel" style={{ width: 260, height: 48, borderRadius: 999 }} />
    </div>
  );
}
