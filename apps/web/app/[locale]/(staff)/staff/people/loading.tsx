/** Skeleton of the person lookup: head, the search panel, then the person and sign-in panels. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 240, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <span className="skel" style={{ display: 'block', height: 170, borderRadius: 40 }} />
      <div className="ad-grid">
        <span className="skel" style={{ display: 'block', height: 240, borderRadius: 40 }} />
        <span className="skel" style={{ display: 'block', height: 240, borderRadius: 40 }} />
      </div>
      <span className="skel" style={{ display: 'block', height: 200, borderRadius: 40 }} />
    </div>
  );
}
