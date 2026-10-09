/** Skeleton of the olympiad list: head, "New olympiad", then the olympiad cards. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 220, height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 520, height: 16 }} />
        </div>
      </div>
      <div className="fam-panel">
        <span className="skel" style={{ width: 200, height: 22 }} />
        <span className="skel" style={{ width: 180, height: 48, borderRadius: 999 }} />
        {[0, 1, 2].map((i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 132, borderRadius: 20 }} />
        ))}
      </div>
    </div>
  );
}
