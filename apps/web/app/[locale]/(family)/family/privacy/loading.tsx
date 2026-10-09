import { SkelHead, SkelPanel } from '@/components/family/access/parts';

/** The note, then one delete-data panel per child. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead picker={false} />
      <div className="skel" style={{ height: 52 }} />
      <div className="ac-stackPage">
        <SkelPanel rows={2} />
        <SkelPanel rows={2} />
      </div>
    </div>
  );
}
