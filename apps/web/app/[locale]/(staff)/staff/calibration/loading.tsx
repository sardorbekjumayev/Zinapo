/** Skeleton of the calibration page: head, the explainer and toolbar, the compare panel, then grade sections. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 280, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <div className="cb-top">
        <span className="skel" style={{ display: 'block', height: 260, borderRadius: 40 }} />
        <span className="skel" style={{ display: 'block', height: 260, borderRadius: 40 }} />
      </div>
      <span className="skel" style={{ display: 'block', height: 150, borderRadius: 40 }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="cb-grade">
          <span className="skel" style={{ width: 160, height: 26 }} />
          <span className="skel" style={{ display: 'block', height: 220, borderRadius: 30 }} />
        </div>
      ))}
    </div>
  );
}
