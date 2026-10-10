/** Skeleton of the outcomes page: head, year chips, import + summary, then the review queue. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 260, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <div className="ad-oc-years">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skel" style={{ width: 96, height: 44, borderRadius: 999 }} />
        ))}
      </div>
      <div className="ad-oc-top">
        <span className="skel" style={{ display: 'block', height: 420, borderRadius: 40 }} />
        <span className="skel" style={{ display: 'block', height: 420, borderRadius: 40 }} />
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 200, height: 26 }} />
        {[0, 1, 2].map((i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 72, borderRadius: 20 }} />
        ))}
      </div>
    </div>
  );
}
