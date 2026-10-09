import type { CSSProperties } from 'react';

/** The queue while it loads: head, the four tabs, the status filter, case rows. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
        <span className="skel" style={line(260, 34)} />
        <span className="skel" style={line('55%')} />
      </div>
      <div className="fam-inline" style={{ '--gap': '8px' } as CSSProperties}>
        {[120, 190, 150, 200].map((w, i) => (
          <span key={i} className="skel" style={{ width: w, height: 44, borderRadius: 999 }} />
        ))}
      </div>
      <div className="fam-inline" style={{ '--gap': '8px' } as CSSProperties}>
        {[90, 170, 110].map((w, i) => (
          <span key={i} className="skel" style={{ width: w, height: 40, borderRadius: 999 }} />
        ))}
      </div>
      <div className="fam-stack" style={{ '--gap': '12px' } as CSSProperties}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skel" style={{ height: 112, borderRadius: 20 }} />
        ))}
      </div>
    </div>
  );
}
