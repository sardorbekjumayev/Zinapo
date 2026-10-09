import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';

/** "No access" / "not found" in the house `.state` style, with a way back. */
export function EditorState({
  title,
  body,
  href,
  cta,
  icon = 'lock',
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  icon?: 'lock' | 'alert';
}) {
  return (
    <section className="state" role={icon === 'alert' ? 'alert' : undefined}>
      <span className={icon === 'alert' ? 'state__icon state__icon--error' : 'state__icon state__icon--empty'}>
        <Icon name={icon} size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{title}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
      </div>
      <Link href={href} className="fam-btn fam-btn--primary">
        {cta}
      </Link>
    </section>
  );
}

function SkelPanel({ rows, tall = false }: { rows: number; tall?: boolean }) {
  return (
    <div className="fam-panel" aria-hidden="true">
      <div className="skel" style={{ width: '35%', height: 24 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ width: '100%', height: tall ? 72 : 48, borderRadius: 20 }} />
      ))}
    </div>
  );
}

/** design/12 loading: header, the three main cards and the side column. */
export function EditorSkeleton({ side = true }: { side?: boolean }) {
  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }} aria-busy="true">
      <div className="pageHead" aria-hidden="true">
        <div className="fam-stack" style={{ flex: 1 }}>
          <div className="skel" style={{ width: 120, height: 14 }} />
          <div className="skel" style={{ width: 280, maxWidth: '80%', height: 34 }} />
          <div className="skel" style={{ width: 420, maxWidth: '95%', height: 16 }} />
        </div>
        <div className="skel" style={{ width: 220, height: 48, borderRadius: 999 }} />
      </div>
      <div className="fam-grid">
        <div className="fam-col">
          <SkelPanel rows={3} />
          <SkelPanel rows={2} tall />
          <SkelPanel rows={4} tall />
        </div>
        {side && (
          <div className="fam-col">
            <SkelPanel rows={2} />
            <SkelPanel rows={2} tall />
            <SkelPanel rows={3} />
          </div>
        )}
      </div>
    </div>
  );
}
