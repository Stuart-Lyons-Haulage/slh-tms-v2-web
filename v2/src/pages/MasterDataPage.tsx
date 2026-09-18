import { useEffect, useState } from 'react';
import { api, MasterCounts } from '../lib/api';

const labels: Array<[keyof MasterCounts, string]> = [
  ['customers', 'Customers'],
  ['sites', 'Sites'],
  ['markets', 'Markets'],
  ['drivers', 'Drivers'],
];

export function MasterDataPage() {
  const [counts, setCounts] = useState<MasterCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.masterCounts()
      .then(setCounts)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load Master Data.'));
  }, []);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Single source of truth</p>
          <h1>Master Data</h1>
          <p>Orders, planning, tracking and integrations resolve against these canonical records.</p>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="grid">
        {labels.map(([key, label]) => (
          <article className="card" key={key}>
            <span className="metric-label">{label}</span>
            <strong className="metric">{counts ? counts[key] : '—'}</strong>
          </article>
        ))}
        <article className="card">
          <span className="metric-label">Vehicles</span>
          <strong className="metric">Next</strong>
        </article>
        <article className="card">
          <span className="metric-label">Trailers</span>
          <strong className="metric">Next</strong>
        </article>
      </div>

      <div className="notice">
        V2 Master Data is isolated from V1. No parser or integration is allowed to create duplicate master records.
      </div>
    </section>
  );
}
