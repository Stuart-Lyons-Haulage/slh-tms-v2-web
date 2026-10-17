import type {
  DispatchDriverDto,
  DispatchEquipmentTrailer,
  DispatchEquipmentVehicle,
  DispatchRunDto,
  DispatchSkillName
} from "./types";

export const dispatchSkills: Array<{ skill: DispatchSkillName; badge: string; label: string }> = [
  { skill: "DoubleDecker", badge: "DD", label: "Double-decker" },
  { skill: "MarketRun", badge: "MKT", label: "Market run" },
  { skill: "HazChem", badge: "ADR", label: "ADR / HazChem" },
  { skill: "Moffett", badge: "MOFF", label: "Moffett" },
  { skill: "TailLift", badge: "TL", label: "Tail-lift" },
  { skill: "RefrigeratedUnit", badge: "TEMP", label: "Refrigerated unit" },
  { skill: "ManualHandling", badge: "MH", label: "Manual handling" }
];

export function parseSkillFlags(value?: string): Set<DispatchSkillName> {
  const known = new Set(dispatchSkills.map(item => item.skill));
  return new Set(
    (value || "")
      .split(/[,|;]/)
      .map(token => token.trim())
      .filter((token): token is DispatchSkillName => known.has(token as DispatchSkillName))
  );
}

export function missingSkills(driver: DispatchDriverDto, run: DispatchRunDto): DispatchSkillName[] {
  const held = parseSkillFlags(driver.skills);
  return [...parseSkillFlags(run.requiredSkills)].filter(skill => !held.has(skill));
}

export function canDriverTakeRun(driver: DispatchDriverDto, run: DispatchRunDto): boolean {
  return !driver.isBlocked && missingSkills(driver, run).length === 0;
}

export function normaliseRegistration(value?: string): string {
  return (value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function tachoVehicleId(driver: DispatchDriverDto, vehicles: DispatchEquipmentVehicle[]): string {
  const target = normaliseRegistration(driver.tachoData.lastVehicleRegistration);
  if (!target) return "";
  return vehicles.find(vehicle => normaliseRegistration(vehicle.registration) === target)?.id || "";
}

export function trailerEligible(run: DispatchRunDto | undefined, trailer: DispatchEquipmentTrailer): boolean {
  if (!run) return true;
  const type = (trailer.type || "").toLowerCase();
  if (run.requiresDoubleDeck && !/(double|deck)/.test(type)) return false;
  if (run.requiresRefrigerated && !/(refrig|fridge|chill|temp)/.test(type)) return false;
  return true;
}

export function ukTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

export function wtdClass(hours: number): "ok" | "amber" | "red" {
  return hours >= 48 ? "red" : hours >= 40 ? "amber" : "ok";
}
