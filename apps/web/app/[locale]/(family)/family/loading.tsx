'use client';

import { usePathname } from 'next/navigation';

/**
 * Skeleton of the family home: page head, then a grid of child cards.
 *
 * A `loading.tsx` here is also the fallback for every nested family route that
 * has none of its own (access, consents, the wizard…), so the child-card grid
 * is drawn only on `/family` itself; elsewhere a neutral panel shape.
 */
export default function Loading() {
  const path = usePathname() ?? '';
  const home = /^\/[^/]+\/family\/?$/.test(path);

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties} aria-busy="true">
      <div className="pageHead">
        <div className="fam-stack" style={{ flex: 1 }}>
          <span className="skel" style={{ width: 90, height: 12 }} />
          <span className="skel" style={{ width: 220, height: 34 }} />
          <span className="skel" style={{ width: 320, height: 16 }} />
        </div>
        {home && <span className="skel" style={{ width: 200, height: 48, borderRadius: 999 }} />}
      </div>
      {home ? (
        <ul className="fp-kids">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <div className="fp-kid">
                <span className="fp-kid__head">
                  <span className="skel" style={{ width: 52, height: 52, borderRadius: '50%' }} />
                  <span className="fam-stack" style={{ '--gap': '8px', flex: 1 } as React.CSSProperties}>
                    <span className="skel" style={{ width: '60%', height: 18 }} />
                    <span className="skel" style={{ width: '30%', height: 12 }} />
                  </span>
                </span>
                <span className="skel" style={{ width: '80%', height: 14 }} />
                <span className="skel" style={{ width: 120, height: 24, borderRadius: 999 }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="fam-panel">
          <span className="skel" style={{ width: '40%', height: 22 }} />
          <span className="skel" style={{ width: '70%', height: 14 }} />
          <span className="skel" style={{ width: '100%', height: 120 }} />
        </div>
      )}
    </div>
  );
}
