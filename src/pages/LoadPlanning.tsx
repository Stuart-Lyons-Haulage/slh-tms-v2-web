import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import QuickOrderForm from '../components/OrderEntry/QuickOrderForm';
import LoadSummaryPanel from '../components/LoadPlanning/LoadSummaryPanel';
import '../styles/LoadPlanning.css';

interface Site {
  id: string;
  externalCode: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export const LoadPlanning: React.FC = () => {
  const { get } = useApi();
  const [customers, setCustomers] = useState<Site[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [deliveryDestinations, setDeliveryDestinations] = useState<Site[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load master data
  useEffect(() => {
    const loadMasterData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch customers
        const customersData = await get('/api/v1/master/customers');
        setCustomers(customersData || []);

        // Fetch sites
        const sitesData = await get('/api/v1/master/sites');
        setSites(sitesData || []);

        // For now, use sites as delivery destinations too
        setDeliveryDestinations(sitesData || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load master data');
      } finally {
        setIsLoading(false);
      }
    };

    loadMasterData();
  }, []);

  const handleOrderSubmitted = () => {
    // Trigger load summary refresh by incrementing key
    setRefreshKey((prev) => prev + 1);
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
  };

  return (
    <div className="load-planning-page">
      {/* Page Header */}
      <header className="page-header">
        <div className="header-content">
          <h1>📊 Load Planning</h1>
          <p className="header-subtitle">
            Enter orders and track real-time load consolidation. Use both windows to build tomorrow's runs.
          </p>
        </div>

        <div className="header-controls">
          <label htmlFor="collectionDate" className="date-label">
            Select Date:
          </label>
          <input
            id="collectionDate"
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="date-input"
          />
        </div>
      </header>

      {/* Main Layout: Dual Windows */}
      <div className="layout-container">
        {/* Left Panel: Order Entry Form */}
        <div className="panel-column panel-left">
          <div className="panel-wrapper">
            {isLoading ? (
              <div className="loading-state">
                <p>Loading master data...</p>
              </div>
            ) : error ? (
              <div className="error-state">
                <p className="error-message">⚠️ {error}</p>
                <p className="error-detail">Please refresh the page to try again.</p>
              </div>
            ) : (
              <QuickOrderForm
                customers={customers}
                sites={sites}
                deliveryDestinations={deliveryDestinations}
                onOrderSubmitted={handleOrderSubmitted}
              />
            )}
          </div>
        </div>

        {/* Right Panel: Load Summary (Auto-Refreshing) */}
        <div className="panel-column panel-right">
          <div className="panel-wrapper">
            <LoadSummaryPanel
              key={refreshKey}
              collectionDate={selectedDate}
              autoRefreshIntervalMs={2500}
              onExportPDF={handleOrderSubmitted}
            />
          </div>
        </div>
      </div>

      {/* Instructions Panel */}
      <section className="instructions-panel">
        <details>
          <summary className="instructions-summary">
            ℹ️ How to use this dual-window planner
          </summary>
          <div className="instructions-content">
            <div className="instruction-section">
              <h4>Left Window: Order Entry</h4>
              <ol>
                <li>
                  <strong>Select Collection Date</strong> at the top (defaults to today)
                </li>
                <li>
                  <strong>Choose Customer</strong> from the dropdown (41 active sites)
                </li>
                <li>
                  <strong>Collection Site auto-filters</strong> to that customer's locations
                </li>
                <li>
                  <strong>Pick Delivery Destination</strong> (where the load is going)
                </li>
                <li>
                  <strong>Enter Pallet Count</strong> (read from current spreadsheet or customer email)
                </li>
                <li>
                  <strong>Add Collection Window</strong> (optional: early/late times)
                </li>
                <li>
                  <strong>Special Instructions</strong> (loading guide ref, temperature, etc.)
                </li>
                <li>
                  <strong>Click Submit Order</strong> → Order created instantly
                </li>
              </ol>
            </div>

            <div className="instruction-section">
              <h4>Right Window: Load Summary (Auto-Refreshing)</h4>
              <ul>
                <li>
                  <strong>Refreshes every 2.5 seconds</strong> automatically as you add orders
                </li>
                <li>
                  <strong>Shows all loads for the selected date</strong> with real-time pallet counts
                </li>
                <li>
                  <strong>Utilization bar</strong> shows how full each load is (max 30 pallets typical)
                </li>
                <li>
                  <strong>Total Pallets & Efficiency</strong> metrics update in real-time
                </li>
                <li>
                  <strong>Vehicle assignments</strong> shown once load is optimized
                </li>
                <li>
                  <strong>Export PDF</strong> button generates Lions Collections format (matches spreadsheet)
                </li>
              </ul>
            </div>

            <div className="instruction-section">
              <h4>Transition Strategy</h4>
              <p>
                <strong>Week 1:</strong> Keep Lions Collections spreadsheet open in background. Enter orders
                in TMS, then compare the auto-generated PDF to your manual spreadsheet. Target 90%+ accuracy.
              </p>
              <p>
                <strong>Week 2:</strong> Trust TMS for pallet counts. Use spreadsheet only to spot-check edge
                cases.
              </p>
              <p>
                <strong>Week 3+:</strong> TMS becomes source of truth. Spreadsheets archived for reference.
              </p>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
};

export default LoadPlanning;
