/** Skeleton of the roster: head, counters, the runner card, then roster rows. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <span className="skel" style={{ width: 120, height: 18 }} />
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 260, maxWidth: '100%', height: 14 }} />
          <span className="skel" style={{ width: 320, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '50%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <div className="fn-counts fn-counts--wide">
        {[0, 1, 2, 3, 4].map((k) => (
          <span key={k} className="skel" style={{ display: 'block', height: 76, borderRadius: 24 }} />
        ))}
      </div>
      <span className="skel" style={{ display: 'block', height: 120, borderRadius: 40 }} />
      <div className="fam-panel">
        <span className="skel" style={{ width: 160, height: 24 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 64, borderRadius: 16 }} />
        ))}
      </div>
    </div>
  );
}
