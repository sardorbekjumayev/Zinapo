import { SkelHead, SkelPanel } from '@/components/family/access/parts';

/** One consents panel per child, three rows each. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead picker={false} />
      <div className="ac-stackPage">
        <SkelPanel rows={3} />
        <SkelPanel rows={3} />
      </div>
    </div>
  );
}
