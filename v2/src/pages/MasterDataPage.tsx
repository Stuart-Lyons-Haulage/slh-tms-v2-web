const areas = ['Customers', 'Sites', 'Markets', 'Drivers', 'Vehicles', 'Trailers'];

export function MasterDataPage() {
  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Single source of truth</p>
          <h1>Master Data</h1>
          <p>All V2 operational workflows will resolve against these canonical records.</p>
        </div>
      </header>
      <div className="grid">
        {areas.map(area => (
          <article className="card" key={area}>
            <span className="metric-label">Canonical</span>
            <strong className="metric">{area}</strong>
          </article>
        ))}
      </div>
      <div className="notice">The V2 master screens are isolated from the live V1 application.</div>
    </section>
  );
}
