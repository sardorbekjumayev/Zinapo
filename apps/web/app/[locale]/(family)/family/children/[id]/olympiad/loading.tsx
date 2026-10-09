import type { CSSProperties } from 'react';

/** Skeleton of the olympiad page: hero, the four-step strip, then stages + results beside cup and privacy. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={line(160, 14)} />
      <div className="fam-panel">
        <span className="skel" style={line(120, 12)} />
        <span className="skel" style={line(220, 38)} />
        <span className="skel" style={line('70%')} />
      </div>
      <div className="fam-panel">
        <span className="skel" style={line('40%', 22)} />
        <div className="ol-timeline">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
              <span className="skel" style={{ width: 28, height: 28, borderRadius: '50%' }} />
              <span className="skel" style={line('70%', 20)} />
              <span className="skel" style={line('50%')} />
              <span className="skel" style={line('90%', 32)} />
            </div>
          ))}
        </div>
      </div>
      <div className="fam-grid">
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('45%', 22)} />
            <span className="skel" style={{ width: '100%', height: 150, borderRadius: 24 }} />
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={line('100%', 64)} />
            ))}
          </div>
          <div className="fam-panel">
            <span className="skel" style={line(160, 12)} />
            <span className="skel" style={line(260, 52)} />
            <span className="skel" style={line('90%')} />
            <span className="skel" style={line('100%', 80)} />
          </div>
        </div>
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={line('60%', 22)} />
            <span className="skel" style={line('100%', 60)} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={line('50%', 12)} />
            <span className="skel" style={line('100%', 48)} />
            <span className="skel" style={line('100%', 48)} />
          </div>
        </div>
      </div>
    </div>
  );
}
