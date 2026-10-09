/** Skeleton of the player: the kid bar, then the ready card and the adult card. */
export default function Loading() {
  return (
    <>
      <div className="kid__bar kd-bar" aria-hidden="true">
        <span className="skel" style={{ width: 40, height: 40, borderRadius: 14 }} />
        <span className="skel" style={{ width: 90, height: 20 }} />
        <span className="skel" style={{ width: 110, height: 28, borderRadius: 999 }} />
      </div>
      <main className="kid__stage kd-stage" aria-busy="true">
        <div className="kd-split">
          <section className="kd-card kd-main">
            <span className="skel" style={{ width: 110, height: 12 }} />
            <span className="skel" style={{ width: '70%', height: 34 }} />
            <span className="skel" style={{ width: '90%', height: 18 }} />
            <div className="kd-facts">
              <span className="skel" style={{ height: 88, borderRadius: 24 }} />
              <span className="skel" style={{ height: 88, borderRadius: 24 }} />
              <span className="skel" style={{ height: 88, borderRadius: 24 }} />
            </div>
            <span className="skel" style={{ width: '100%', height: 96, borderRadius: 24 }} />
            <span className="skel" style={{ width: 200, height: 64, borderRadius: 999 }} />
          </section>
          <aside className="kd-card kd-side">
            <span className="skel" style={{ width: 140, height: 12 }} />
            <span className="skel" style={{ width: '80%', height: 22 }} />
            <span className="skel" style={{ width: '100%', height: 90 }} />
          </aside>
        </div>
      </main>
    </>
  );
}
