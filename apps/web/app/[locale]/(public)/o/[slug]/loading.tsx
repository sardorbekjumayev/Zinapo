import type { CSSProperties } from 'react';

/** The landing while it loads: title card with the button, then the stage strip. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="fam-panel">
        <span className="skel" style={line(180, 12)} />
        <span className="skel" style={line('75%', 38)} />
        <span className="skel" style={line(240, 24)} />
        <span className="skel" style={line('85%')} />
        <span className="skel" style={{ width: 280, height: 48, borderRadius: 999 }} />
      </div>
      <div className="fam-panel">
        <span className="skel" style={line('30%', 22)} />
        <div className="ol-timeline">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
              <span className="skel" style={{ width: 28, height: 28, borderRadius: '50%' }} />
              <span className="skel" style={line('70%', 20)} />
              <span className="skel" style={line('50%')} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
