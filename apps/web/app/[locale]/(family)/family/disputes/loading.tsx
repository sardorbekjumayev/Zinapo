import { SkelHead } from '@/components/family/access/parts';

/** Shaped like the dispute list: a heading, then case rows. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead picker={false} />
      <ul className="dp-list" aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i} className="dp-row">
            <div className="skel" style={{ width: 44, height: 44, borderRadius: '50%', flex: 'none' }} />
            <div className="fam-stack" style={{ flex: 1 }}>
              <div className="skel" style={{ width: '45%', height: 16 }} />
              <div className="skel" style={{ width: '30%', height: 20 }} />
              <div className="skel" style={{ width: '70%', height: 14 }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
