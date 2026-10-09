import type { CSSProperties } from 'react';

/** The application form while it loads: header, title, three choices, fields. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }} aria-busy="true">
        <span className="skel" style={line('100%', 56)} />
        <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
          <span className="skel" style={line(120, 12)} />
          <span className="skel" style={line(320, 34)} />
          <span className="skel" style={line('70%')} />
        </div>
        <div className="fam-panel">
          <span className="skel" style={line(140, 16)} />
          <div className="iv-choices">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ height: 96, borderRadius: 20 }} />
            ))}
          </div>
          <div className="fam-row">
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
            <span className="skel" style={{ height: 48, borderRadius: 999 }} />
          </div>
          <span className="skel" style={line(200, 16)} />
          <div className="fam-inline" style={{ '--gap': '10px' } as CSSProperties}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ width: 140, height: 44, borderRadius: 999 }} />
            ))}
          </div>
          <span className="skel" style={{ width: 200, height: 48, borderRadius: 999, alignSelf: 'flex-end' }} />
        </div>
      </main>
    </div>
  );
}
