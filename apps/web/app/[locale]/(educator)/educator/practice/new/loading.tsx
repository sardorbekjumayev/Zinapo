import type { CSSProperties } from 'react';

/** Skeleton of the builder: band, head with the source switch, the choices beside the set. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={{ width: '100%', height: 56, borderRadius: 999 }} />
      <span className="skel" style={line(140, 14)} />
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
          <span className="skel" style={line(160, 12)} />
          <span className="skel" style={line(300, 34)} />
          <span className="skel" style={line(360, 16)} />
        </div>
        <span className="skel" style={{ width: 300, height: 52, borderRadius: 999 }} />
      </div>
      <div className="pr-builder">
        <div className="fam-panel">
          <span className="skel" style={line('60%', 22)} />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={{ width: '100%', height: 92, borderRadius: 24 }} />
          ))}
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('70%', 22)} />
          <span className="skel" style={{ width: '100%', height: 72, borderRadius: 14 }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="skel" style={{ width: '100%', height: 64, borderRadius: 20 }} />
          ))}
          <span className="skel" style={{ width: 200, height: 48, borderRadius: 999, alignSelf: 'flex-end' }} />
        </div>
      </div>
    </div>
  );
}
