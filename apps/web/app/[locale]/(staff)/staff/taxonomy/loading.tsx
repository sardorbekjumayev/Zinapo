import { SkelHead, SkelTable } from '@/components/staff/bank/parts';

/** Taxonomy loading: header, the rule note, the tabs, then one list panel. */
export default function Loading() {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <SkelHead button={false} />
      <div className="skel" style={{ width: '100%', height: 52, borderRadius: 16 }} aria-hidden="true" />
      <div className="skel" style={{ width: 420, maxWidth: '100%', height: 48, borderRadius: 999 }} aria-hidden="true" />
      <SkelTable rows={6} filters={false} />
    </div>
  );
}
