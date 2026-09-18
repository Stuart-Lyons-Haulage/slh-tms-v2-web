export function OverviewPage() {
  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Clean rebuild</p>
          <h1>Operations overview</h1>
          <p>Only proven capabilities are reintroduced into V2, one bounded area at a time.</p>
        </div>
        <div className="status good">V2 foundation</div>
      </header>
      <div className="grid">
        <article className="card">
          <span className="metric-label">Foundation</span>
          <strong className="metric">Isolated</strong>
          <p>V1 remains the live production system while V2 is built and verified.</p>
        </article>
        <article className="card">
          <span className="metric-label">Source of truth</span>
          <strong className="metric">Master Data</strong>
          <p>Customers, sites, markets, drivers and fleet identities are canonical.</p>
        </article>
        <article className="card">
          <span className="metric-label">Intake principle</span>
          <strong className="metric">Resolve, don't invent</strong>
          <p>Unmatched data goes to review rather than creating duplicate master records.</p>
        </article>
      </div>
    </section>
  );
}
