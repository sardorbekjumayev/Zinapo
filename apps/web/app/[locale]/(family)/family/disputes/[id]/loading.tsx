import { SkelHead, SkelPanel } from '@/components/family/access/parts';

/** Shaped like a dispute: statements on the left, the timeline and next steps on the right. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead picker={false} />
      <div className="fam-grid">
        <div className="fam-col">
          <div className="fam-panel" aria-hidden="true">
            <div className="skel" style={{ width: '40%', height: 24 }} />
            <div className="skel" style={{ width: '85%', height: 14 }} />
            <div className="skel" style={{ width: '100%', height: 72 }} />
            <div className="skel" style={{ width: '100%', height: 140, borderRadius: 'var(--radius-sm)' }} />
          </div>
        </div>
        <div className="fam-col">
          <SkelPanel rows={3} />
          <SkelPanel rows={3} />
        </div>
      </div>
    </div>
  );
}
