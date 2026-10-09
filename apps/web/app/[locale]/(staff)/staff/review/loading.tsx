/** Skeleton of design/13: page head with four stat tiles, the queue, the item. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead rv-head">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 280, height: 34 }} />
          <span className="skel" style={{ width: '70%', maxWidth: 520, height: 16 }} />
        </div>
        <div className="rv-stats">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={{ width: 92, height: 64, borderRadius: 20 }} />
          ))}
        </div>
      </div>
      <div className="rv-grid">
        <div className="fam-panel">
          <span className="skel" style={{ width: '40%', height: 20 }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="skel" style={{ width: '100%', height: 52, borderRadius: 16 }} />
          ))}
        </div>
        <div className="fam-panel">
          <span className="skel" style={{ width: '50%', height: 24 }} />
          <span className="skel" style={{ width: 260, height: 36, borderRadius: 999 }} />
          <span className="skel" style={{ width: '100%', height: 110, borderRadius: 20 }} />
          <div className="rv-options">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skel" style={{ height: 56, borderRadius: 999 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
