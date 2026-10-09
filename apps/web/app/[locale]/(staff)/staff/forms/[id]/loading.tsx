/** Skeleton of design/14: head, the 30-tile position grid, and the side cards. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 100, height: 14 }} />
          <span className="skel" style={{ width: 360, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 520, height: 16 }} />
        </div>
      </div>
      <div className="fam-grid fb-grid">
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={{ width: '30%', height: 22 }} />
            <ul className="fb-tiles">
              {Array.from({ length: 30 }, (_, i) => (
                <li key={i}>
                  <span className="skel" style={{ display: 'block', height: 72, borderRadius: 16 }} />
                </li>
              ))}
            </ul>
          </div>
          <div className="fam-panel">
            <span className="skel" style={{ width: '35%', height: 20 }} />
            <span className="skel" style={{ width: '100%', height: 36, borderRadius: 999 }} />
            <span className="skel" style={{ width: '100%', height: 36, borderRadius: 999 }} />
          </div>
        </div>
        <div className="fam-col">
          <div className="fam-panel">
            <span className="skel" style={{ width: '40%', height: 14 }} />
            <span className="skel" style={{ width: '60%', height: 26 }} />
            <span className="skel" style={{ width: '100%', height: 160, borderRadius: 20 }} />
          </div>
          <div className="fam-panel">
            <span className="skel" style={{ width: '50%', height: 20 }} />
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="skel" style={{ width: '100%', height: 40 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
