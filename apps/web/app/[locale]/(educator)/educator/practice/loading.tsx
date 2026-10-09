import type { CSSProperties } from 'react';

/** Skeleton of the practice list: band, head, the "Did it work?" card, earlier sets. */
export default function Loading() {
  const line = (width: string | number, height = 14): CSSProperties => ({ width, height });
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <span className="skel" style={{ width: '100%', height: 56, borderRadius: 999 }} />
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
          <span className="skel" style={line(90, 12)} />
          <span className="skel" style={line(260, 34)} />
          <span className="skel" style={line(320, 16)} />
        </div>
        <span className="skel" style={{ width: 220, height: 48, borderRadius: 999 }} />
      </div>
      <div className="pr-listGrid">
        <div className="fam-panel">
          <span className="skel" style={line(140, 12)} />
          <span className="skel" style={line('70%', 22)} />
          <div className="pr-stats">
            <span className="skel" style={{ height: 100, borderRadius: 24 }} />
            <span className="skel" style={{ height: 100, borderRadius: 24 }} />
          </div>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} className="skel" style={line('100%', 18)} />
          ))}
          <span className="skel" style={{ width: '100%', height: 96, borderRadius: 24 }} />
        </div>
        <div className="fam-panel">
          <span className="skel" style={line('40%', 22)} />
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={line('100%', 64)} />
          ))}
        </div>
      </div>
    </div>
  );
}
