export interface TelemetryPointDto {
  vehicleIdentifier: string;
  eventTimeUtc: string;
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  isMoving?: boolean;
  ignitionOn?: boolean;
  status?: string;
}

export interface TelemetryDto {
  provider: string;
  retrievedAtUtc: string;
  recordCount: number;
  records: TelemetryPointDto[];
}

export interface TachoVehicleDriverStatusDto {
  vehicleCode: string;
  memberCode: number;
  driverName: string;
  cardNumber?: string;
  employeeNumber?: string;
  dutyStartUtc: string;
  dutyEndUtc?: string;
  driveMinutes?: number;
  workMinutes?: number;
  breakMinutes?: number;
  dailyDriverPeriodsAvailable?: number;
  driveAvailableTodayMinutes?: number;
  driveAvailableTomorrowMinutes?: number;
  driveAvailableWeekMinutes?: number;
  workAvailableWeekMinutes?: number;
  evidenceSource?: string;
}

export type FleetTrackingCondition = 'Moving' | 'Started' | 'Parked' | 'Stationary' | 'SignedOn' | 'Stale' | 'NotSignedOn';

export interface FleetVehicleTrackingDto {
  vehicleId: string;
  registration: string;
  fleetNumber?: string;
  trackingIdentifier?: string;
  condition: FleetTrackingCondition;
  lastEventTimeUtc?: string;
  ignitionOn?: boolean;
  isMoving?: boolean;
  speedKph?: number;
  latitude?: number;
  longitude?: number;
  ageMinutes?: number;
  loadId?: string;
  loadReference?: string;
  loadStatus?: string;
  driverId?: string;
  driverName?: string;
  tachoName?: string;
  driverSource?: string;
  allocatedDriverName?: string;
  driverMismatch: boolean;
  plannedDutyUtc?: string;
  tacho?: TachoVehicleDriverStatusDto;
  fleetioId?: string;
  fleetioName?: string;
  fleetioStatus?: string;
  fleetioVor?: boolean;
  fleetioPmiDueUtc?: string;
  fleetioMotDueUtc?: string;
  fleetioServiceStatus?: string;
  driverMatchReason?: string;
}

export interface FleetStatusDto {
  provider: string;
  retrievedAtUtc: string;
  vehicleCount: number;
  readyCount: number;
  attentionCount: number;
  vehicles: FleetVehicleTrackingDto[];
}

export type EtaSource = 'Live' | 'Planned' | 'Unavailable' | 'Estimated';
export type EtaRisk = 'Pending' | 'Late' | 'AtRisk' | 'OnTrack';

export interface DeliveryEtaDto {
  loadId: string;
  loadReference: string;
  loadStatus: string;
  stopId: string;
  sequence: number;
  stopName: string;
  orderReference?: string;
  customerCode?: string;
  vehicleRegistration?: string;
  etaUtc?: string;
  source: EtaSource;
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  risk: EtaRisk;
  trackingUpdatedAtUtc?: string;
  tachoDriverName?: string;
  driveAvailableTodayMinutes?: number;
  routeDrivingMinutes?: number;
  breakMinutesIncluded?: number;
  tachoStatus?: string;
  tachoExplanation?: string;
}

export interface DeliveryEtasDto {
  planningDate: string;
  calculatedAtUtc: string;
  records: DeliveryEtaDto[];
}

export interface TrackingStateDto {
  provider: string;
  vehicleId?: string;
  runId?: string;
  orderId?: string;
  lastLocation?: string;
  latitude?: number;
  longitude?: number;
  lastUpdateUtc?: string;
  syncStatus?: string;
}

export interface EtaStateDto {
  runId: string;
  stopId?: string;
  etaUtc?: string;
  source: EtaSource;
  risk: EtaRisk;
  calculatedAtUtc?: string;
}
