import React, { useState, useEffect, useMemo } from 'react';
import { useApi } from '../../hooks/useApi';
import { Button } from '../Common/Button';
import './RunBuilder.css';

interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerCode: string;
  collectionSiteName: string;
  collectionSiteId: string;
  deliveryDestinationName: string;
  deliveryDestinationId: string;
  palletQtyOrdered: number;
  palletQtyToRun: number;
  status: 'ToPlan' | 'Planned' | 'Split';
  createdAt: string;
}

interface Site {
  id: string;
  externalCode: string;
  name: string;
}

interface RunBuilderProps {
  collectionDate?: string;
  onRunCreated?: () => void;
}

export const RunBuilder: React.FC<RunBuilderProps> = ({
  collectionDate = new Date().toISOString().split('T')[0],
  onRunCreated,
}) => {
  const { get, post } = useApi();

  // State
  const [toPlannedOrders, setToPlannedOrders] = useState<Order[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [siteSearchInput, setSiteSearchInput] = useState<string>('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSiteDropdown, setShowSiteDropdown] = useState(false);

  // Load orders to plan
  useEffect(() => {
    const loadOrders = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const orders = await get(`/api/v1/orders?status=ToP lan&collectionDate=${collectionDate}`);
        setToPlannedOrders(orders || []);

        const sitesData = await get('/api/v1/master/sites');
        setSites(sitesData || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      } finally {
        setIsLoading(false);
      }
    };

    loadOrders();
  }, [collectionDate]);

  // Filter sites based on search input
  const filteredSites = useMemo(() => {
    if (!siteSearchInput) return sites;
    const lower = siteSearchInput.toLowerCase();
    return sites.filter(
      (s) => s.name.toLowerCase().includes(lower) || s.externalCode.toLowerCase().includes(lower)
    );
  }, [sites, siteSearchInput]);

  // Get orders for selected site
  const ordersForSelectedSite = useMemo(() => {
    if (!selectedSiteId) return [];
    return toPlannedOrders.filter((o) => o.collectionSiteId === selectedSiteId);
  }, [toPlannedOrders, selectedSiteId]);

  // Get delivery destinations for selected orders
  const deliveryDestinations = useMemo(() => {
    const dests = new Set<string>();
    selectedOrders.forEach((orderId) => {
      const order = toPlannedOrders.find((o) => o.id === orderId);
      if (order) dests.add(order.deliveryDestinationId);
    });
    return Array.from(dests);
  }, [selectedOrders, toPlannedOrders]);

  // Handle site selection
  const handleSiteSelect = (siteId: string, siteName: string) => {
    setSelectedSiteId(siteId);
    setSiteSearchInput(siteName);
    setShowSiteDropdown(false);
    setSelectedOrders([]); // Reset order selection
  };

  // Handle order selection (checkbox)
  const handleOrderToggle = (orderId: string) => {
    setSelectedOrders((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  // Handle pallet qty change
  const handlePalletQtyChange = (orderId: string, newQty: number) => {
    setToPlannedOrders((prev) =>
      prev.map((order) =>
        order.id === orderId ? { ...order, palletQtyToRun: Math.min(newQty, order.palletQtyOrdered) } : order
      )
    );
  };

  // Create run from selected orders
  const handleCreateRun = async () => {
    if (selectedOrders.length === 0) {
      setError('Select at least one order');
      return;
    }

    try {
      const runOrders = selectedOrders.map((orderId) => {
        const order = toPlannedOrders.find((o) => o.id === orderId);
        return {
          orderId: order!.orderId,
          palletQty: order!.palletQtyToRun,
          splitRemaining: order!.palletQtyToRun < order!.palletQtyOrdered,
        };
      });

      const response = await post('/api/v1/runs', {
        collectionDate,
        collectionSiteId: selectedSiteId,
        deliveryDestinationIds: deliveryDestinations,
        orders: runOrders,
      });

      if (response.ok) {
        // Refresh orders
        const updatedOrders = await get(`/api/v1/orders?status=ToP lan&collectionDate=${collectionDate}`);
        setToPlannedOrders(updatedOrders || []);

        // Reset form
        setSelectedSiteId('');
        setSiteSearchInput('');
        setSelectedOrders([]);
        setError(null);

        onRunCreated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create run');
    }
  };

  const totalPallets = useMemo(() => {
    return selectedOrders.reduce((sum, orderId) => {
      const order = toPlannedOrders.find((o) => o.id === orderId);
      return sum + (order?.palletQtyToRun || 0);
    }, 0);
  }, [selectedOrders, toPlannedOrders]);

  return (
    <div className="run-builder">
      <div className="builder-header">
        <h3>🚚 Build Run</h3>
        <p className="builder-hint">Start typing collection point → select orders → adjust qty → confirm</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Site Search & Selection */}
      <div className="site-selector">
        <label>Collection Point *</label>
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Start typing site name or code..."
            value={siteSearchInput}
            onChange={(e) => {
              setSiteSearchInput(e.target.value);
              setShowSiteDropdown(true);
            }}
            onFocus={() => setShowSiteDropdown(true)}
            className="site-search-input"
          />
          {showSiteDropdown && siteSearchInput && (
            <div className="site-dropdown">
              {filteredSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  className={`site-option ${selectedSiteId === site.id ? 'selected' : ''}`}
                  onClick={() => handleSiteSelect(site.id, site.name)}
                >
                  <span className="site-name">{site.name}</span>
                  <span className="site-code">{site.externalCode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Orders from Selected Site */}
      {selectedSiteId && ordersForSelectedSite.length > 0 && (
        <div className="orders-section">
          <h4>Orders from {ordersForSelectedSite[0]?.collectionSiteName}</h4>
          <div className="orders-table-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th className="checkbox-col"></th>
                  <th>Customer</th>
                  <th>Delivery Destination</th>
                  <th className="numeric">Ordered</th>
                  <th className="numeric">To Run</th>
                  <th className="numeric">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {ordersForSelectedSite.map((order) => {
                  const isSelected = selectedOrders.includes(order.id);
                  const remaining = order.palletQtyOrdered - order.palletQtyToRun;

                  return (
                    <tr key={order.id} className={isSelected ? 'selected' : ''}>
                      <td className="checkbox-col">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleOrderToggle(order.id)}
                        />
                      </td>
                      <td>
                        <div className="customer-cell">
                          <div className="customer-name">{order.customerName}</div>
                          <div className="customer-code">{order.customerCode}</div>
                        </div>
                      </td>
                      <td>{order.deliveryDestinationName}</td>
                      <td className="numeric font-bold">{order.palletQtyOrdered}</td>
                      <td className="numeric">
                        {isSelected ? (
                          <input
                            type="number"
                            min="1"
                            max={order.palletQtyOrdered}
                            value={order.palletQtyToRun}
                            onChange={(e) =>
                              handlePalletQtyChange(order.id, parseInt(e.target.value) || 0)
                            }
                            className="qty-input"
                          />
                        ) : (
                          order.palletQtyOrdered
                        )}
                      </td>
                      <td className={`numeric ${remaining > 0 ? 'text-warning' : ''}`}>
                        {remaining > 0 && <span className="split-badge">Split {remaining}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Run Summary */}
          {selectedOrders.length > 0 && (
            <div className="run-summary">
              <div className="summary-stat">
                <span className="label">Selected Orders:</span>
                <span className="value">{selectedOrders.length}</span>
              </div>
              <div className="summary-stat">
                <span className="label">Total Pallets:</span>
                <span className="value font-bold">{totalPallets}</span>
              </div>
              <div className="summary-stat">
                <span className="label">Destinations:</span>
                <span className="value">{deliveryDestinations.length}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="builder-actions">
            <Button
              variant="primary"
              onClick={handleCreateRun}
              disabled={selectedOrders.length === 0 || isLoading}
              className="btn-create-run"
            >
              ✓ Confirm Run ({totalPallets} pallets)
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedSiteId('');
                setSiteSearchInput('');
                setSelectedOrders([]);
              }}
              className="btn-reset"
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {selectedSiteId && ordersForSelectedSite.length === 0 && !isLoading && (
        <div className="empty-state">
          <p>No orders waiting for this collection point</p>
        </div>
      )}

      {isLoading && <div className="loading-state">Loading orders...</div>}
    </div>
  );
};

export default RunBuilder;
