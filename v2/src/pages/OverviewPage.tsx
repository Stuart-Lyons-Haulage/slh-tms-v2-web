import { useCallback, useEffect, useState } from 'react';
import { api, MasterCounts, ReviewAllocation } from '../lib/api';

export function OverviewPage() {
  const [master, setMaster] = useState<MasterCounts | null>(null);
  const [review, setReview] = useState<ReviewAllocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [masterData, reviewData] = await Promise.all([
        api.masterCounts(),
        api.reviewAllocations(),
      ]);
      setMaster(masterData);
      setReview(reviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Foundation health view could not refresh.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Audited foundation</p>
          <h1>SLH TMS V2</h1>
          <p>Canonical Master Data, explicit review and the order/intake foundation. Planning and live integrations are added only after this baseline is proven.</p>
        </div>
        <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="grid master-grid">
        <article className="card compact-card">
          <span className="metric-label">Sites</span>
          <strong className="metric">{master?.sites ?? 0}</strong>
          <p>Canonical Site CRM records.</p>
        </article>
        <article className="card compact-card">
          <span className="metric-label">Drivers</span>
          <strong className="metric">{master?.drivers ?? 0}</strong>
          <p>Driver identities held in Master Data.</p>
        </article>
        <article className="card compact-card">
          <span className="metric-label">Vehicles</span>
          <strong className="metric">{master?.vehicles ?? 0}</strong>
          <p>Fleet vehicles and cab phones.</p>
        </article>
        <article className="card compact-card">
          <span className="metric-label">Trailers</span>
          <strong className="metric">{master?.trailers ?? 0}</strong>
          <p>Trailer capacity source of truth.</p>
        </article>
        <article className="card compact-card">
          <span className="metric-label">Fuel cards</span>
          <strong className="metric">{master?.fuelCards ?? 0}</strong>
          <p>Fuel cards separated from Vehicle records.</p>
        </article>
        <article className="card compact-card">
          <span className="metric-label">Review</span>
          <strong className="metric">{review.length}</strong>
          <p>Unresolved relationships requiring allocation.</p>
        </article>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Release gate</p>
            <h2>Foundation scope</h2>
          </div>
          <span className="status good">Local-first</span>
        </div>
        <p className="muted">This branch intentionally excludes Planning, Dashboard operations logic and external API writers. Those packages are layered on only after the foundation build, schema, restart and Master Data acceptance checks pass.</p>
      </div>
    </section>
  );
}
