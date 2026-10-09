import type { CSSProperties } from 'react';

/** Skeleton of "My children": head, one child card beside the conflict-of-interest rules. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="ed-head">
        <div className="ed-head__text">
          <span className="skel" style={line(240, 36)} />
          <span className="skel" style={line(360, 16)} />
        </div>
        <span className="skel" style={{ width: 380, height: 52, borderRadius: 999 }} />
      </div>
      <div className="fam-grid">
        <div className="fam-panel">
          <div className="ed-kid__head">
            <span className="skel" style={{ width: 52, height: 52, borderRadius: '50%' }} />
            <div className="ed-kid__who">
              <span className="skel" style={line(200, 22)} />
              <span className="skel" style={line(160)} />
            </div>
          </div>
          <span className="skel" style={line('100%', 40)} />
          <span className="skel" style={{ width: 180, height: 48, borderRadius: 999 }} />
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('60%', 22)} />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={line('100%', 44)} />
          ))}
        </div>
      </div>
    </div>
  );
}
