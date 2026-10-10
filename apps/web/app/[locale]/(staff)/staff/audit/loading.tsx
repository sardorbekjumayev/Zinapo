/** Skeleton of the audit log: head, the note, the filters, then table rows. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 200, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '50%', maxWidth: 420, height: 16 }} />
        </div>
      </div>
      <span className="skel" style={{ display: 'block', height: 52, borderRadius: 20 }} />
      <span className="skel" style={{ display: 'block', height: 130, borderRadius: 40 }} />
      <div className="fam-panel">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="skel" style={{ display: 'block', height: 36 }} />
        ))}
      </div>
    </div>
  );
}
