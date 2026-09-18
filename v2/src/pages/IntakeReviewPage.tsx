import { useCallback, useEffect, useState } from 'react';
import { api, IntakeReviewRecord } from '../lib/api';

export function IntakeReviewPage() {
  const [records, setRecords] = useState<IntakeReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await api.intakeReview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load intake review.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(id: string, action: 'resolve' | 'approve' | 'promote') {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'resolve') await api.resolveIntake(id);
      if (action === 'approve') await api.approveIntake(id);
      if (action === 'promote') await api.promoteIntake(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The intake action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Canonical pipeline</p>
          <h1>Intake Review</h1>
          <p>Evidence → extraction → Master Data resolution → validation → approval → order.</p>
        </div>
        <button className="button" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </header>

      <div className="notice">
        V2 never silently creates customers or sites. Anything unresolved stays here until Master Data is corrected.
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="grid">
        <article className="card">
          <span className="metric-label">Waiting for review</span>
          <strong className="metric">{loading ? '—' : records.length}</strong>
        </article>
        <article className="card">
          <span className="metric-label">Matching</span>
          <strong className="metric">Exact first</strong>
        </article>
        <article className="card">
          <span className="metric-label">Promotion</span>
          <strong className="metric">Explicit only</strong>
        </article>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Planner review queue</p>
            <h2>Orders requiring attention</h2>
          </div>
        </div>

        {loading ? (
          <p>Loading intake…</p>
        ) : records.length === 0 ? (
          <p>No unresolved intake records are waiting for review.</p>
        ) : (
          <div className="review-list">
            {records.map(record => (
              <article className="review-row" key={record.id}>
                <div className="review-main">
                  <strong>{record.reviewReason || 'Master Data review required'}</strong>
                  <span>
                    Confidence {Math.round((record.confidence || 0) * 100)}% · Received{' '}
                    {new Date(record.createdAtUtc).toLocaleString()}
                  </span>
                </div>
                <div className="review-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busyId === record.id}
                    onClick={() => void runAction(record.id, 'resolve')}
                  >
                    Re-check Master
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
