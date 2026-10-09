/** Skeleton of one olympiad: head, rules, the four stages, venues, then the entries table. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <span className="skel" style={{ width: 140, height: 16 }} />
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 360, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: 320, maxWidth: '80%', height: 24, borderRadius: 999 }} />
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 120, height: 22 }} />
        <div className="oa-facts">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="skel" style={{ display: 'block', height: 56, borderRadius: 14 }} />
          ))}
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 140, height: 22 }} />
        <div className="oa-stages">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skel" style={{ display: 'block', height: 180, borderRadius: 20 }} />
          ))}
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 180, height: 22 }} />
        <span className="skel" style={{ display: 'block', height: 140, borderRadius: 14 }} />
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 160, height: 22 }} />
        <span className="skel" style={{ width: 420, maxWidth: '100%', height: 44, borderRadius: 999 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 40, borderRadius: 8 }} />
        ))}
      </div>
    </div>
  );
}
