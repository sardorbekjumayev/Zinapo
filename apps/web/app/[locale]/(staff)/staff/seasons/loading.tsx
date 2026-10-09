/** Skeleton of the season manager: head, the season list, then the wave calendar. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 280, height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 520, height: 16 }} />
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 160, height: 22 }} />
        {[0, 1].map((i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 72, borderRadius: 20 }} />
        ))}
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 260, height: 22 }} />
        {[0, 1, 2].map((g) => (
          <div key={g} className="ss-waves">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="skel" style={{ display: 'block', height: 150, borderRadius: 18 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
