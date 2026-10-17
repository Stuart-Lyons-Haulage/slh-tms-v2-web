import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { Button } from '../Common/Button';
import './LoadSummaryPanel.css';

interface Load {
  id: string;
  loadNumber: number;
  customerName: string;
  customerCode: string;
  collectionSiteName: string;
  deliveryDestinationName: string;
  palletsInLoad: number;
  maxCapacity: number;
  assignedVehicle?: string;
  estimatedCollectionTime?: string;
  estimatedDeliveryTime?: string;
  status: 'Draft' | 'Assigned' | 'InTransit' | 'Delivered';
}

interface LoadSummaryPanelProps {
  collectionDate?: string;
  autoRefreshIntervalMs?: number;
  onExportPDF?: () => void;
}

export const LoadSummaryPanel: React.FC<LoadSummaryPanelProps> = ({
  collectionDate = new Date().toISOString().split('T')[0],
  autoRefreshIntervalMs = 2500,
  onExportPDF,
}) => {
  const { get } = useApi();
  const [loads, setLoads] = useState<Load[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [totalPallets, setTotalPallets] = useState(0);
  const [totalCapacity, setTotalCapacity] = useState(0);
  const [utilizationPercent, setUtilizationPercent] = useState(0);

  // Fetch loads for the selected date
  const fetchLoads = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await get(`/api/v1/loads?collectionDate=${collectionDate}`);
      if (response && Array.isArray(response)) {
        setLoads(response);

        // Calculate totals
        const totalP = response.reduce((sum, load) => sum + (load.palletsInLoad || 0), 0);
        const totalC = response.reduce((sum, load) => sum + (load.maxCapacity || 20), 0);
        const utilization = totalC > 0 ? Math.round((totalP / totalC) * 100) : 0;

        setTotalPallets(totalP);
        setTotalCapacity(totalC);
        setUtilizationPercent(utilization);
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch loads');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-refresh on interval
  useEffect(() => {
    fetchLoads(); // Initial fetch

    const interval = setInterval(() => {
      fetchLoads();
    }, autoRefreshIntervalMs);

    return () => clearInterval(interval);
  }, [collectionDate, autoRefreshIntervalMs]);

  const getUtilizationColor = (percent: number) => {
    if (percent >= 85) return 'text-green';
    if (percent >= 70) return 'text-yellow';
    return 'text-orange';
  };

  const getStatusBadge = (status: string) => {
    const statusClass = `badge badge-${status.toLowerCase()}`;
    return statusClass;
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExport = async () => {
    try {
      const response = await fetch(`/api/v1/loads/export-pdf?collectionDate=${collectionDate}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lions-Collections-${collectionDate}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      setError('Failed to export PDF');
    }
  };

  return (
    <div className="load-summary-panel">
      {/* Panel Header */}
      <div className="panel-header">
        <div className="header-title">
          <h3>📦 Today's Loads</h3>
          <span className="date-badge">{collectionDate}</span>
        </div>
        <div className="header-actions">
          <button
            className="btn-icon"
            onClick={fetchLoads}
            title="Manual refresh"
            aria-label="Refresh loads"
          >
            ⟳
          </button>
        </div>
      </div>

      {/* Totals Summary */}
      <div className="summary-metrics">
        <div className="metric">
          <div className="metric-label">Total Pallets</div>
          <div className="metric-value">{totalPallets}</div>
          <div className="metric-detail">of {totalCapacity} capacity</div>
        </div>

        <div className="metric">
          <div className="metric-label">Utilization</div>
          <div className={`metric-value ${getUtilizationColor(utilizationPercent)}`}>
            {utilizationPercent}%
          </div>
          <div className="metric-detail">{loads.length} loads</div>
        </div>

        <div className="metric">
          <div className="metric-label">Last Refresh</div>
          <div className="metric-value">
            {lastRefresh
              ? lastRefresh.toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : 'N/A'}
          </div>
          <div className="metric-detail">Auto every {autoRefreshIntervalMs / 1000}s</div>
        </div>
      </div>

      {/* Error Message */}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Loads Table */}
      <div className="loads-table-container">
        <table className="loads-table">
          <thead>
            <tr>
              <th>Load #</th>
              <th>Customer</th>
              <th>Collection Site</th>
              <th>Delivery Destination</th>
              <th className="numeric">Pallets</th>
              <th className="numeric">Utilization</th>
              <th>Vehicle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loads.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8} className="text-center">
                  {isLoading ? 'Loading...' : 'No loads yet. Start entering orders.'}
                </td>
              </tr>
            ) : (
              loads.map((load) => (
                <tr key={load.id} className={`load-row status-${load.status.toLowerCase()}`}>
                  <td className="font-mono font-bold">{load.loadNumber}</td>
                  <td>
                    <div className="customer-cell">
                      <span className="customer-name">{load.customerName}</span>
                      <span className="customer-code">{load.customerCode}</span>
                    </div>
                  </td>
                  <td>{load.collectionSiteName}</td>
                  <td>{load.deliveryDestinationName}</td>
                  <td className="numeric font-bold">
                    {load.palletsInLoad}/{load.maxCapacity}
                  </td>
                  <td className="numeric">
                    <div className="utilization-bar">
                      <div
                        className="utilization-fill"
                        style={{
                          width: `${(load.palletsInLoad / load.maxCapacity) * 100}%`,
                        }}
                      />
                      <span className="utilization-text">
                        {Math.round((load.palletsInLoad / load.maxCapacity) * 100)}%
                      </span>
                    </div>
                  </td>
                  <td>{load.assignedVehicle || '—'}</td>
                  <td>
                    <span className={getStatusBadge(load.status)}>{load.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Panel Actions */}
      <div className="panel-actions">
        <Button
          variant="secondary"
          size="small"
          onClick={handlePrint}
          title="Print summary"
        >
          🖨️ Print
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={handleExport}
          title="Export as PDF (Lions Collections format)"
        >
          📥 Export PDF
        </Button>
        <div className="auto-refresh-indicator">
          <span className="pulse" />
          <span className="text-small">Auto-refreshing</span>
        </div>
      </div>

      {/* Hidden Print Stylesheet */}
      <style>{`
        @media print {
          .load-summary-panel {
            width: 100%;
            page-break-inside: avoid;
          }
          .panel-header,
          .panel-actions,
          .btn-icon {
            display: none;
          }
          .loads-table {
            width: 100%;
            border-collapse: collapse;
          }
        }
      `}</style>
    </div>
  );
};

export default LoadSummaryPanel;
