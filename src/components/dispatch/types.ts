export type DispatchSkillName =
  | "DoubleDecker"
  | "MarketRun"
  | "HazChem"
  | "Moffett"
  | "TailLift"
  | "RefrigeratedUnit"
  | "ManualHandling";

export type DispatchFilter = "all" | "unallocated" | "backloads" | "warnings" | "skills-mismatch";
export type DispatchEmploymentFilter = "all" | "employed" | "agency" | "casual" | "subcontractor";

export interface DispatchGeoPointDto {
  latitude: number;
  longitude: number;
}

export interface DispatchCollectionPointDto {
  name: string;
  latitude?: number;
  longitude?: number;
}

export interface DispatchTachoDataDto {
  currentDutyDay: number;
  shiftEndTimeUtc?: string;
  weeklyWorkingTime: number;
  dailyDrivingTime: number;
  breakCompliance: boolean;
  lastVehicleRegistration?: string;
  requiredRestPeriod: number;
  reducedDailyRestsUsed: number;
  dailyDrivingLimitMinutes?: number;
  driveAvailablePlanningDayMinutes?: number;
  workAvailableWeekMinutes?: number;
  reducedDailyRestAvailable?: boolean;
}

export interface DispatchTrackingDataDto {
  lastKnownPosition?: DispatchGeoPointDto;
  lastStopName?: string;
  lastPositionAtUtc?: string;
}

export interface DispatchHistoryItem {
  driverId: string;
  previousRunId?: string;
  previousRunReference?: string;
  previousPlanningDate?: string;
  previousTrailerId?: string;
  previousTrailerNumber?: string;
  previousTrailerPlanningDate?: string;
  previousFinalStopName?: string;
  previousFinalLatitude?: number;
  previousFinalLongitude?: number;
}

export interface DispatchDriverDto {
  driverId: string;
  driverCode: string;
  name: string;
  employmentType: "Employed" | "HalfTramper" | "AgencyDay" | "AgencyLong" | string;
  skills: string;
  holidayDates: string[];
  contractedDays: string[];
  homeDepot?: string;
  tachoData: DispatchTachoDataDto;
  trackingData: DispatchTrackingDataDto;
  needsReturn: boolean;
  availableFrom?: string;
  isBlocked: boolean;
  blockedReason?: string;
  suggestedRunId?: string;
  suggestedRunReference?: string;
  distanceToSuggestedCollectionMiles?: number;
  backloadCandidate: boolean;
  deadheadReductionMiles?: number;
  suggestion?: string;
  previousRunReference?: string;
  previousPlanningDate?: string;
  previousTrailerId?: string;
  previousTrailerNumber?: string;
  previousTrailerPlanningDate?: string;
}

export interface DispatchRunDto {
  runId: string;
  reference: string;
  collectionPoint: DispatchCollectionPointDto;
  requiredSkills: string;
  requiresDoubleDeck: boolean;
  requiresRefrigerated: boolean;
  isBackload: boolean;
  isOvernightMarket: boolean;
  isSouthbound: boolean;
  firstCollectionTimeUtc?: string;
  finalDeliveryPoint?: DispatchCollectionPointDto;
  plannerNotes?: string;
  trailerSwapRequested?: boolean;
}

export interface DispatchAvailableTimeDto {
  driverId: string;
  availableFrom?: string;
  requiredRestPeriod: number;
  weeklyWorkingTimeUsed: number;
  dailyDrivingTimeUsed: number;
  wtdStatus: "ok" | "amber" | "red" | string;
  breachDetail?: string;
}

export interface DispatchLockFailure {
  driverId: string;
  runId?: string;
  reason: string;
}

export interface DispatchLockResponse {
  success: boolean;
  failures: DispatchLockFailure[];
}

export interface DispatchAllocationSelection {
  runId: string;
  vehicleId: string;
  trailerId: string;
  plannedStartTime?: string;
  useReducedDailyRest?: boolean;
}

export interface DispatchEquipmentVehicle {
  id: string;
  registration: string;
  fleetNumber?: string;
  fleetioStatus?: string;
  active?: boolean;
}

export interface DispatchEquipmentTrailer {
  id: string;
  trailerNumber: string;
  type?: string;
  active?: boolean;
}

export interface LegacyDispatchStop {
  id: string;
  sequence: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
  plannerNote?: string;
}

export interface LegacyDispatchLoad {
  id: string;
  reference?: string;
  rawReference?: string;
  status?: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string;
  plannedStartUtc?: string;
  plannerNotes?: string;
  southbound?: boolean;
  stops?: LegacyDispatchStop[];
}

export interface DispatchEquipmentWorkbench {
  vehicles: DispatchEquipmentVehicle[];
  trailers: DispatchEquipmentTrailer[];
  loads: LegacyDispatchLoad[];
}

export interface DispatchDriverStatusDto {
  driverId: string;
  dispatchStatus: "No Run" | "Awaiting Dispatch" | "Sent Awaiting Response" | "Confirmed" | string;
  lastDriverReply?: string;
  lastDriverReplyAtUtc?: string;
  lastDispatchSentAtUtc?: string;
  weeklyRestStatus?: "Ready" | "DueSoon" | "Overdue" | "Unverified" | "Unknown" | string;
  weeklyRestMessage?: string;
  availabilityStatus?: "Available" | "Unavailable" | "Unverified" | string;
  availabilityMessage?: string;
  driveAvailablePlanningDayMinutes?: number;
  workAvailableWeekMinutes?: number;
  projectedDayNumber?: number;
  earliestStartUtc?: string;
  earliestStartSource?: string;
  earliestStartIsAssumption?: boolean;
  operationalStatus?: "No Run" | "Awaiting Dispatch" | "Dispatched" | "Working" | "Completed" | string;
  driverConfirmed?: boolean;
  driverConfirmationAtUtc?: string;
}

export interface DispatchVisibilityItem {
  driverId: string;
  employmentType: "Employed" | "Agency" | "Casual" | "Subcontractor" | string;
  skills?: string;
  coding?: string;
  lastTachoRead?: string;
  lastLiveActivity?: string;
  lastExecutedRun?: string;
  currentlyAllocated: boolean;
  rosteredAgency: boolean;
  subcontractor: boolean;
  evidence: string;
}

export interface DispatchVisibilitySnapshot {
  planningDate: string;
  windowDays: number;
  cutoffDate: string;
  drivers: DispatchVisibilityItem[];
}
