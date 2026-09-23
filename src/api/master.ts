import { request } from "../lib/api";

export type MasterDriver = {
  driverId: string;
  fullName: string;
  preferredName?: string;
  licenceNumber?: string;
  licenceExpiry?: string;
  cpcExpiry?: string;
  digitalTachoCardExpiry?: string;
  medicalExpiry?: string;
  employmentType?: string;
  agencyName?: string;
  isActive: boolean;
};

export type MasterVehicle = {
  vehicleId: string;
  fleetNumber?: string;
  registration: string;
  vehicleType?: string;
  fleetioAssetId?: string;
  samsaraAssetId?: string;
  motExpiry?: string;
  tachoCalibrationExpiry?: string;
  vehicleTestExpiry?: string;
  fleetioStatus?: string;
  isActive: boolean;
};

export type MasterTrailer = {
  trailerId: string;
  fleetNumber?: string;
  registration?: string;
  trailerNumber?: string;
  trailerType?: string;
  motExpiry?: string;
  testExpiry?: string;
  isActive: boolean;
};

export type MasterCustomer = {
  customerId: string;
  customerName: string;
  accountCode?: string;
  tradingName?: string;
  isActive: boolean;
};

export type MasterSite = {
  siteId: string;
  siteName: string;
  customerId?: string;
  customerCode?: string;
  address?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  siteType?: string;
  isActive: boolean;
};

export type MasterDispatchData = {
  drivers: MasterDriver[];
  vehicles: MasterVehicle[];
  trailers: MasterTrailer[];
  customers: MasterCustomer[];
  sites: MasterSite[];
};

export async function getMasterDispatchData(token: string): Promise<MasterDispatchData> {
  const [drivers, vehicles, trailers, customers, sites] = await Promise.all([
    request<MasterDriver[]>("/api/master/drivers", token),
    request<MasterVehicle[]>("/api/master/vehicles", token),
    request<MasterTrailer[]>("/api/master/trailers", token),
    request<MasterCustomer[]>("/api/master/customers", token),
    request<MasterSite[]>("/api/master/sites", token)
  ]);
  return { drivers, vehicles, trailers, customers, sites };
}
