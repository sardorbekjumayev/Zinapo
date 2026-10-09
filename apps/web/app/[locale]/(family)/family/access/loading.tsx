import { SkelHead, SkelPanel } from '@/components/family/access/parts';

/** design/06 loading: the two columns, shaped like the panels they become. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead />
      <div className="fam-grid ac-grid">
        <div className="fam-col">
          <SkelPanel rows={1} />
          <SkelPanel rows={3} />
          <SkelPanel rows={4} />
        </div>
        <div className="fam-col">
          <SkelPanel rows={3} />
          <SkelPanel rows={2} />
        </div>
      </div>
    </div>
  );
}
