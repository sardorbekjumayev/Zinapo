import type { CSSProperties } from 'react';

/** The cases screen while it loads: head, tabs, applications beside the pre-approve panel. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
        <span className="skel" style={line(200, 34)} />
        <span className="skel" style={line('55%')} />
      </div>
      <div className="fam-inline" style={{ '--gap': '8px' } as CSSProperties}>
        {[200, 170, 170, 150].map((w, i) => (
          <span key={i} className="skel" style={{ width: w, height: 44, borderRadius: 999 }} />
        ))}
      </div>
      <div className="iv-casesGrid">
        <div className="fam-panel">
          <span className="skel" style={line('40%', 22)} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={line('100%', 84)} />
          ))}
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('60%', 22)} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={{ height: 48, borderRadius: 999 }} />
          ))}
          <span className="skel" style={line('100%', 60)} />
        </div>
      </div>
    </div>
  );
}
