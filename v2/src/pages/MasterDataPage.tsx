import { useEffect, useMemo, useState } from 'react';
import { api, MasterCounts, MasterWorkbookImportResult } from '../lib/api';

const labels: Array<[keyof MasterCounts, string]> = [
  ['customers', 'Customers'],
  ['sites', 'Sites'],
  ['drivers', 'Drivers'],
  ['vehicles', 'Vehicles'],
  ['markets', 'Markets'],
  ['trailers', 'Trailers'],
  ['siteCutoffs', 'Site cut-offs'],
  ['routeTimes', 'Route times'],
  ['customerContacts', 'Customer contacts'],
  ['marketContacts', 'Market contacts'],
  ['fuelPrices', 'Fuel prices'],
  ['aliasCandidates', 'Aliases to review'],
];

export function MasterDataPage() {
  const [counts, setCounts] = useState<MasterCounts | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MasterWorkbookImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCounts = async () => {
    setCounts(await api.masterCounts());
  };

  useEffect(() => {
    refreshCounts().catch(err =>
      setError(err instanceof Error ? err.message : 'Unable to load Master Data.'),
    );
  }, []);

  const preparedRows = useMemo(
    () => preview
      ? Object.entries(preview.rows).reduce((total, [, count]) => total + count, 0)
      : 0,
    [preview],
  );

  async function runImport(commit: boolean) {
    if (!selectedFile) return;

    setBusy(commit ? 'commit' : 'preview');
    setError(null);
    try {
      const result = await api.uploadMasterWorkbook(selectedFile, commit);
      setPreview(result);
      if (commit) await refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master Data workbook import failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Single source of truth</p>
          <h1>Master Data</h1>
          <p>Customers, sites, drivers, vehicles, route timings and source aliases live here before any order parser can use them.</p>
        </div>
        <div className="status good">Canonical V2</div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="grid master-grid">
        {labels.map(([key, label]) => (
          <article className="card compact-card" key={key}>
            <span className="metric-label">{label}</span>
            <strong className="metric">{counts ? counts[key] : '—'}</strong>
          </article>
        ))}
      </div>

      <div className="panel import-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Controlled workbook import</p>
            <h2>Master Data Workbook</h2>
            <p className="muted">
              Preview first. Nothing is committed until you explicitly choose Import to V2.
            </p>
          </div>
        </div>

        <div className="import-controls">
          <label className="file-picker">
            <span>Choose .xlsx workbook</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={event => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
              }}
            />
          </label>

          <div className="selected-file">
            {selectedFile ? (
              <>
                <strong>{selectedFile.name}</strong>
                <span>{Math.max(1, Math.round(selectedFile.size / 1024))} KB</span>
              </>
            ) : (
              <span>No workbook selected</span>
            )}
          </div>

          <div className="review-actions">
            <button
              className="button secondary"
              type="button"
              disabled={!selectedFile || busy !== null}
              onClick={() => void runImport(false)}
            >
              {busy === 'preview' ? 'Checking…' : 'Preview workbook'}
            </button>
            <button
              className="button"
              type="button"
              disabled={!selectedFile || !preview || busy !== null}
              onClick={() => void runImport(true)}
            >
              {busy === 'commit' ? 'Importing…' : 'Import to V2'}
            </button>
          </div>
        </div>

        {preview && (
          <div className="import-result">
            <div className="import-summary">
              <div>
                <span className="metric-label">Rows prepared</span>
                <strong className="metric">{preparedRows}</strong>
              </div>
              <div>
                <span className="metric-label">Review issues</span>
                <strong className="metric">{preview.issues.length}</strong>
              </div>
              <div>
                <span className="metric-label">Status</span>
                <strong className="metric">{preview.committed ? 'Imported' : 'Preview only'}</strong>
              </div>
            </div>

            <div className="sheet-breakdown">
              {Object.entries(preview.rows).map(([sheet, count]) => (
                <div className="sheet-row" key={sheet}>
                  <span>{sheet}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>

            {preview.issues.length > 0 && (
              <div className="issue-box">
                <strong>Needs review</strong>
                <ul>
                  {preview.issues.slice(0, 40).map((issue, index) => (
                    <li key={`${index}-${issue}`}>{issue}</li>
                  ))}
                </ul>
                {preview.issues.length > 40 && (
                  <p>Showing the first 40 of {preview.issues.length} issues.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="notice">
        V2 never invents a customer/site match from fuzzy text. Unmapped collection and delivery aliases are staged for review instead of being silently merged.
      </div>
    </section>
  );
}
