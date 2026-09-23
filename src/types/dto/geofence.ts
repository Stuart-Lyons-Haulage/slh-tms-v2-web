export interface GeofenceDto {
  id: string;
  siteId: string;
  siteName?: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  active: boolean;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}

export interface GeofenceVisitDto {
  id: string;
  geofenceId: string;
  siteId?: string;
  siteName?: string;
  vehicleId?: string;
  vehicleRegistration?: string;
  runId?: string;
  runReference?: string;
  arrivedAtUtc: string;
  departedAtUtc?: string;
  durationMinutes?: number;
  source?: string;
  isCurrent?: boolean;
}
