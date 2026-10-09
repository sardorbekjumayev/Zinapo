/** Skeleton of the form list: head, the filter row, then form rows. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 240, height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <div className="fb-toolbar">
        <span className="skel" style={{ width: 360, maxWidth: '100%', height: 48, borderRadius: 999 }} />
        <span className="skel" style={{ width: 150, height: 48, borderRadius: 999 }} />
      </div>
      <ul className="fb-list">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <span className="skel" style={{ display: 'block', height: 76, borderRadius: 24 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
