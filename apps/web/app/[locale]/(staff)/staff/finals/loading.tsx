/** Skeleton of /staff/finals: the head, then venue cards with counters and two buttons. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 240, maxWidth: '100%', height: 34 }} />
          <span className="skel" style={{ width: '60%', maxWidth: 520, height: 16 }} />
        </div>
      </div>
      <div className="fn-venues">
        {[0, 1].map((i) => (
          <div key={i} className="fam-panel fn-venue">
            <span className="skel" style={{ width: '40%', height: 14 }} />
            <span className="skel" style={{ width: '55%', height: 26 }} />
            <span className="skel" style={{ width: '70%', height: 16 }} />
            <div className="fn-counts">
              {[0, 1, 2].map((k) => (
                <span key={k} className="skel" style={{ display: 'block', height: 76, borderRadius: 24 }} />
              ))}
            </div>
            <span className="skel" style={{ width: 320, maxWidth: '100%', height: 48, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
