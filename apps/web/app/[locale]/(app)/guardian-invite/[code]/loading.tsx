import type { CSSProperties } from 'react';

/** Skeleton of the invite landing: header bar, then the invitation panel. */
export default function Loading() {
  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }} aria-busy="true">
        <span className="skel" style={{ width: '100%', height: 72, borderRadius: 999 }} />
        <div className="fam-panel fp-landing">
          <span className="skel" style={{ width: 100, height: 12 }} />
          <div className="fp-head">
            <span className="skel" style={{ width: 52, height: 52, borderRadius: '50%' }} />
            <div className="fp-head__body">
              <span className="skel" style={{ width: '80%', height: 28 }} />
              <span className="skel" style={{ width: 200, height: 14 }} />
            </div>
          </div>
          <span className="skel" style={{ width: '100%', height: 72 }} />
          <div className="fam-stack" style={{ '--gap': '10px' } as CSSProperties}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ width: `${85 - i * 10}%`, height: 16 }} />
            ))}
          </div>
          <div className="fam-actions" style={{ justifyContent: 'flex-end' }}>
            <span className="skel" style={{ width: 140, height: 48, borderRadius: 999 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
