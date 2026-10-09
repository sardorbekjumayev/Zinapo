import type { CSSProperties } from 'react';

/** Skeleton of the group overview: head, wave picker, four tiles, the progress list beside mistakes + reminders. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="ed-head">
        <div className="ed-head__text">
          <span className="skel" style={{ width: 150, height: 26, borderRadius: 999 }} />
          <span className="skel" style={line(320, 36)} />
          <span className="skel" style={line(420, 16)} />
        </div>
        <span className="skel" style={{ width: 380, height: 52, borderRadius: 999 }} />
      </div>
      <div className="fam-inline">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skel" style={{ width: 120, height: 44, borderRadius: 999 }} />
        ))}
      </div>
      <div className="tiles">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skel" style={{ height: 120, borderRadius: 40 }} />
        ))}
      </div>
      <div className="fam-grid ed-grid">
        <div className="fam-panel">
          <span className="skel" style={line('45%', 22)} />
          <span className="skel" style={line('90%')} />
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="skel" style={line('100%', 32)} />
          ))}
        </div>
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('60%', 22)} />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skel" style={line('100%', 72)} />
            ))}
            <span className="skel" style={{ width: '100%', height: 48, borderRadius: 999 }} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={line('60%', 22)} />
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={line('100%', 44)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
