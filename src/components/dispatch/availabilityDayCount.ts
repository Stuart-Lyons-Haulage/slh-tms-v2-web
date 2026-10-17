import type { DriverAvailabilityItem } from "./types";

const DAY_ALIASES = [
  ["MON", "MONDAY", "1"],
  ["TUE", "TUESDAY", "2"],
  ["WED", "WEDNESDAY", "3"],
  ["THU", "THURSDAY", "4"],
  ["FRI", "FRIDAY", "5"],
  ["SAT", "SATURDAY", "6"],
  ["SUN", "SUNDAY", "0"]
];
function usualDayIndexes(value: string | undefined): Set<number> {
  if (!value?.trim()) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const indexes = new Set<number>();
  const indexOf = (token: string) => {
    if (/^[0-6]$/.test(token)) return token === "0" ? 6 : Number(token) - 1;
    const match = DAY_ALIASES.findIndex(aliases => aliases.some(alias => alias.length > 1 && alias.startsWith(token) || alias === token));
    return match;
  };
  for (const part of value.toUpperCase().split(/[,;|]/)) {
    const tokens = part.match(/MONDAY|MON|TUESDAY|TUE|WEDNESDAY|WED|THURSDAY|THU|FRIDAY|FRI|SATURDAY|SAT|SUNDAY|SUN|[0-6]/g) || [];
    const days = tokens.map(indexOf).filter(index => index >= 0);
    if (days.length >= 2 && /-|\bTO\b/.test(part)) {
      for (let current = days[0], count = 0; count < 7; current = (current + 1) % 7, count++) {
        indexes.add(current);
        if (current === days[days.length - 1]) break;
      }
    } else days.forEach(day => indexes.add(day));
  }
  return indexes;
}

function utcDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function londonDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Returns the number of days this confirmed agency/casual availability covers
 * in the planning week. Employed drivers use Sage/Driver Master contracted days.
 */
export function availabilityDayCount(item: DriverAvailabilityItem | undefined, planningDate: string): number | undefined {
  if (!item || (item.employmentType !== "Agency" && item.employmentType !== "Casual")) return undefined;
  if (!item.longTermPlacement) return 1; // A confirmed one-off window is specific to the selected planning day.

  const from = londonDate(item.availableFromUtc);
  const through = item.placementEndDate || londonDate(item.availableUntilUtc);
  if (!from || !through || !Number.isFinite(utcDay(planningDate))) return undefined;

  const selectedDay = utcDay(planningDate);
  const weekStart = selectedDay - ((new Date(selectedDay).getUTCDay() + 6) % 7) * 86_400_000;
  const usualDays = usualDayIndexes(item.usualDays);
  let count = 0;
  for (let offset = 0; offset < 7; offset++) {
    const currentDay = weekStart + offset * 86_400_000;
    if (currentDay < utcDay(from) || currentDay > utcDay(through)) continue;
    const weekday = new Date(currentDay).getUTCDay();
    if (usualDays.has(weekday === 0 ? 6 : weekday - 1)) count++;
  }
  return count || undefined;
}
