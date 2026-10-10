/** Skeleton of the staff roles page: head, the note, then the holders table beside the grant form. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 240, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 480, height: 16 }} />
        </div>
      </div>
      <span className="skel" style={{ display: 'block', height: 52, borderRadius: 20 }} />
      <div className="ad-rolesLayout">
        <span className="skel" style={{ display: 'block', height: 520, borderRadius: 40 }} />
        <span className="skel" style={{ display: 'block', height: 520, borderRadius: 40 }} />
      </div>
    </div>
  );
}
