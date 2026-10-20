import { useCallback } from 'react';
import { api, type Customer, type CustomerContact, type Vehicle, type Driver, type Trailer, type Site, type MarketContact } from './api';
import { useTmsQuery } from './useTmsQuery';

const LOOKUP_STALE = 60_000;
const LOOKUP_GC = 10 * 60_000;

const lookupOptions = { staleTime: LOOKUP_STALE, gcTime: LOOKUP_GC } as const;

export function useVehicles() {
  return useTmsQuery(
    ['lookups', 'vehicles'] as const,
    useCallback((t: string) => api.vehicles(t), []),
    lookupOptions,
  );
}

export function useDrivers() {
  return useTmsQuery(
    ['lookups', 'drivers'] as const,
    useCallback((t: string) => api.drivers(t), []),
    lookupOptions,
  );
}

export function useTrailers() {
  return useTmsQuery(
    ['lookups', 'trailers'] as const,
    useCallback((t: string) => api.trailers(t), []),
    lookupOptions,
  );
}

export function useSites() {
  return useTmsQuery(
    ['lookups', 'sites'] as const,
    useCallback((t: string) => api.sites(t), []),
    lookupOptions,
  );
}

export function useCustomers() {
  return useTmsQuery(
    ['lookups', 'customers'] as const,
    useCallback((t: string) => api.customers(t), []),
    lookupOptions,
  );
}

export function useCustomerContacts() {
  return useTmsQuery(
    ['lookups', 'customerContacts'] as const,
    useCallback((t: string) => api.customerContacts(t), []),
    lookupOptions,
  );
}

export function useMarketContacts() {
  return useTmsQuery(
    ['lookups', 'marketContacts'] as const,
    useCallback((t: string) => api.marketContacts(t), []),
    lookupOptions,
  );
}
