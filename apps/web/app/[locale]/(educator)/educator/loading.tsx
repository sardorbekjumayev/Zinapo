import type { CSSProperties } from 'react';

/** `/educator` usually redirects to the first group, so its skeleton is the group page's head and tiles. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as CSSProperties} aria-busy="true">
      <div className="ed-head">
        <div className="ed-head__text">
          <span className="skel" style={{ width: 150, height: 26, borderRadius: 999 }} />
          <span className="skel" style={{ width: 320, height: 36 }} />
          <span className="skel" style={{ width: 420, height: 16 }} />
        </div>
      </div>
      <div className="tiles">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skel" style={{ height: 120, borderRadius: 40 }} />
        ))}
      </div>
    </div>
  );
}
