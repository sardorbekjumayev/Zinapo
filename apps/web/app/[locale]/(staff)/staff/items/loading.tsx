import { SkelHead, SkelTable, SkelTiles } from '@/components/staff/bank/parts';

/** design/11 loading: header, the grade tiles, then the filter block and rows. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead />
      <SkelTiles />
      <SkelTable rows={10} />
    </div>
  );
}
