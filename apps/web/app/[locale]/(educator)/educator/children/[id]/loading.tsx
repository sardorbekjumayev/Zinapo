import type { CSSProperties } from 'react';

/** Skeleton of the pupil page: back link, head, two blocks, waves, the mistake. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={line(160)} />
      <div className="fam-panel">
        <div className="ed-pupil__head">
          <span className="skel" style={{ width: 52, height: 52, borderRadius: '50%' }} />
          <div className="ed-pupil__who">
            <span className="skel" style={line(80, 12)} />
            <span className="skel" style={line(260, 34)} />
            <span className="skel" style={line(220)} />
          </div>
        </div>
        <div className="ed-pupil__grid">
          <span className="skel" style={line('100%', 90)} />
          <span className="skel" style={line('100%', 90)} />
        </div>
        <span className="skel" style={line(120, 12)} />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skel" style={line('100%', 36)} />
        ))}
        <span className="skel" style={line('100%', 84)} />
      </div>
    </div>
  );
}
