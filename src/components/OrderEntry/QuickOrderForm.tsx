import React, { useState, useEffect } from 'react';
import { Button } from '../Common/Button';
import { useApi } from '../../hooks/useApi';
import './QuickOrderForm.css';

interface Site {
  id: string;
  externalCode: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

interface OrderFormData {
  customerId: string;
  collectionSiteId: string;
  deliveryDestinationId: string;
  palletCount: number;
  collectionWindowStart?: string;
  collectionWindowEnd?: string;
  specialInstructions?: string;
  collectionDate: string;
}

interface QuickOrderFormProps {
  onOrderSubmitted?: () => void;
  customers: Site[];
  sites: Site[];
  deliveryDestinations: Site[];
}

export const QuickOrderForm: React.FC<QuickOrderFormProps> = ({
  onOrderSubmitted,
  customers = [],
  sites = [],
  deliveryDestinations = [],
}) => {
  const { post } = useApi();
  const [formData, setFormData] = useState<OrderFormData>({
    customerId: '',
    collectionSiteId: '',
    deliveryDestinationId: '',
    palletCount: 0,
    collectionDate: new Date().toISOString().split('T')[0],
  });

  const [filteredSites, setFilteredSites] = useState<Site[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filter sites by selected customer
  useEffect(() => {
    if (formData.customerId) {
      const filtered = sites.filter(
        (site) => site.id === formData.customerId || site.name.includes(formData.customerId)
      );
      setFilteredSites(filtered);
      // Auto-clear collection site if customer changes
      setFormData((prev) => ({ ...prev, collectionSiteId: '' }));
    } else {
      setFilteredSites([]);
    }
  }, [formData.customerId, sites]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validation
    if (!formData.customerId || !formData.collectionSiteId || !formData.deliveryDestinationId || formData.palletCount <= 0) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await post('/api/v1/orders', {
        customerId: formData.customerId,
        collectionSiteId: formData.collectionSiteId,
        deliveryDestinationId: formData.deliveryDestinationId,
        palletCount: formData.palletCount,
        collectionWindowStart: formData.collectionWindowStart,
        collectionWindowEnd: formData.collectionWindowEnd,
        specialInstructions: formData.specialInstructions,
        collectionDate: formData.collectionDate,
        status: 'Draft',
      });

      if (response.ok) {
        setSuccess(`Order created! Pallets: ${formData.palletCount}`);
        // Reset form
        setFormData({
          customerId: '',
          collectionSiteId: '',
          deliveryDestinationId: '',
          palletCount: 0,
          collectionDate: new Date().toISOString().split('T')[0],
        });
        onOrderSubmitted?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: keyof OrderFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form className="quick-order-form" onSubmit={handleSubmit}>
      <div className="form-header">
        <h3>📋 New Order</h3>
        <p className="form-hint">Start blank, read pallet quantities from summary panel</p>
      </div>

      {error && <div className="form-alert alert-error">{error}</div>}
      {success && <div className="form-alert alert-success">{success}</div>}

      {/* Collection Date */}
      <div className="form-group">
        <label htmlFor="collectionDate">Collection Date *</label>
        <input
          id="collectionDate"
          type="date"
          value={formData.collectionDate}
          onChange={(e) => handleInputChange('collectionDate', e.target.value)}
          required
        />
      </div>

      {/* Customer Selector */}
      <div className="form-group">
        <label htmlFor="customerId">Customer *</label>
        <select
          id="customerId"
          value={formData.customerId}
          onChange={(e) => handleInputChange('customerId', e.target.value)}
          required
        >
          <option value="">-- Select Customer --</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name} ({customer.externalCode})
            </option>
          ))}
        </select>
      </div>

      {/* Collection Site */}
      <div className="form-group">
        <label htmlFor="collectionSiteId">Collection Site *</label>
        <select
          id="collectionSiteId"
          value={formData.collectionSiteId}
          onChange={(e) => handleInputChange('collectionSiteId', e.target.value)}
          required
          disabled={!formData.customerId}
        >
          <option value="">-- Select Site --</option>
          {filteredSites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name} ({site.externalCode})
            </option>
          ))}
        </select>
      </div>

      {/* Delivery Destination */}
      <div className="form-group">
        <label htmlFor="deliveryDestinationId">Delivery Destination *</label>
        <select
          id="deliveryDestinationId"
          value={formData.deliveryDestinationId}
          onChange={(e) => handleInputChange('deliveryDestinationId', e.target.value)}
          required
        >
          <option value="">-- Select Destination --</option>
          {deliveryDestinations.map((dest) => (
            <option key={dest.id} value={dest.id}>
              {dest.name} ({dest.externalCode})
            </option>
          ))}
        </select>
      </div>

      {/* Pallet Count */}
      <div className="form-group">
        <label htmlFor="palletCount">Pallets Ordered *</label>
        <input
          id="palletCount"
          type="number"
          min="1"
          max="30"
          value={formData.palletCount || ''}
          onChange={(e) => handleInputChange('palletCount', parseInt(e.target.value) || 0)}
          placeholder="0"
          required
        />
        <span className="form-hint-small">Max 30 pallets per load</span>
      </div>

      {/* Collection Window */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="windowStart">Collection From</label>
          <input
            id="windowStart"
            type="time"
            value={formData.collectionWindowStart || ''}
            onChange={(e) => handleInputChange('collectionWindowStart', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="windowEnd">Collection To</label>
          <input
            id="windowEnd"
            type="time"
            value={formData.collectionWindowEnd || ''}
            onChange={(e) => handleInputChange('collectionWindowEnd', e.target.value)}
          />
        </div>
      </div>

      {/* Special Instructions */}
      <div className="form-group">
        <label htmlFor="specialInstructions">Special Instructions</label>
        <textarea
          id="specialInstructions"
          rows={2}
          value={formData.specialInstructions || ''}
          onChange={(e) => handleInputChange('specialInstructions', e.target.value)}
          placeholder="e.g., Loading guide ref, temperature requirements, etc."
        />
      </div>

      {/* Submit Buttons */}
      <div className="form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting}
          className="btn-submit"
        >
          {isSubmitting ? 'Submitting...' : '✓ Submit Order'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setFormData({
              customerId: '',
              collectionSiteId: '',
              deliveryDestinationId: '',
              palletCount: 0,
              collectionDate: new Date().toISOString().split('T')[0],
            })
          }
          className="btn-reset"
        >
          Clear Form
        </Button>
      </div>
    </form>
  );
};

export default QuickOrderForm;
