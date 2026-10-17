const INTERNAL_RUN_REFERENCE = /^PLAN-\d{8}-(.+)$/i;
const DATED_RUN_REFERENCE = /^RUN[\s_-]*\d{8}[\s_-]+0*(\d+)$/i;
const NUMERIC_RUN = /^(?:RUN[\s:_-]*)?(\d+)(?:[\s_-]*(AM|PM))?$/i;
const LEGACY_LOAD_RUN = /^L0*(\d+)$/i;
const PERIOD = /\b(AM|PM)\b/i;

function noteValue(notes: string | undefined, key: string) {
  if (!notes) return undefined;
  const prefix = `${key}:`;
  return notes
    .split("|")
    .map(part => part.trim())
    .find(part => part.toLowerCase().startsWith(prefix.toLowerCase()))
    ?.slice(prefix.length)
    .trim();
}

function explicitPeriod(value?: string) {
  if (!value) return undefined;
  const match = value.match(PERIOD);
  if (match) return match[1].toUpperCase();
  if (/morning/i.test(value)) return "AM";
  if (/afternoon|evening/i.test(value)) return "PM";
  return undefined;
}

function periodFromLocalHour(hour: number) {
  return hour >= 12 ? "PM" : "AM";
}

function periodFromLocalTime(value?: string) {
  if (!value) return undefined;
  // Only treat a value as a local clock when the whole value is a clock. Previously
  // an ISO timestamp beginning "2026-..." was read as hour 20 and therefore PM.
  const match = value.trim().match(/^(\d{1,2}):\d{2}(?::\d{2})?$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? periodFromLocalHour(hour) : undefined;
}

function periodFromPlannedUtc(firstPlannedUtc?: string) {
  if (!firstPlannedUtc) return undefined;
  const localPeriod = periodFromLocalTime(firstPlannedUtc);
  if (localPeriod) return localPeriod;
  const value = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(firstPlannedUtc) ? firstPlannedUtc : `${firstPlannedUtc}Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
  return periodFromLocalHour(Number(hour));
}

function stripInternalReference(reference: string) {
  const dated = reference.trim().match(DATED_RUN_REFERENCE);
  if (dated) return dated[1];
  const match = reference.trim().match(INTERNAL_RUN_REFERENCE);
  return match ? match[1] : reference.trim();
}

function legacyOperationalRunNumber(source: string) {
  const match = source.trim().match(LEGACY_LOAD_RUN);
  if (!match) return undefined;
  const legacyNumber = Number(match[1]);
  return Number.isInteger(legacyNumber) && legacyNumber > 0 ? legacyNumber : undefined;
}

function formatChoice(source: string, period?: string, overnight?: boolean) {
  const clean = source.trim();
  const resolvedPeriod = period || explicitPeriod(clean);
  const legacyNumber = legacyOperationalRunNumber(clean);
  if (legacyNumber != null) {
    return `Run ${legacyNumber}${resolvedPeriod ? ` ${resolvedPeriod}` : ""}${overnight ? " O/N" : ""}`;
  }

  const numeric = clean.match(NUMERIC_RUN);
  if (numeric) {
    const number = String(Number(numeric[1]));
    const numericPeriod = period || explicitPeriod(numeric[2]) || resolvedPeriod;
    return `Run ${number}${numericPeriod ? ` ${numericPeriod}` : ""}${overnight ? " O/N" : ""}`;
  }

  const embeddedPeriod = explicitPeriod(clean);
  const withoutRun = clean.replace(/^RUN[\s:_-]*/i, "").replace(/[-_]+/g, " ").trim() || "TBC";
  const withoutPeriod = embeddedPeriod ? withoutRun.replace(PERIOD, "").trim() : withoutRun;
  return `Run ${withoutPeriod}${resolvedPeriod ? ` ${resolvedPeriod}` : ""}${overnight ? " O/N" : ""}`;
}

function operationalSource(source: string, plannedPeriod?: string) {
  if (!plannedPeriod || !NUMERIC_RUN.test(source.trim())) return source;
  return source.replace(PERIOD, "").trim();
}

function explicitOvernight(value?: string) {
  return Boolean(value && /\b(?:O\/N|overnight|night[ -]?out)\b/i.test(value) && !/\bnight[ -]?out:\s*(?:no|false)\b/i.test(value));
}

export function displayRunReference(reference: string, plannerNotes?: string, firstPlannedUtc?: string, overnight?: boolean) {
  const plannerRun = noteValue(plannerNotes, "Planner run");
  const runType = noteValue(plannerNotes, "Run type");
  const plannedPeriod = periodFromPlannedUtc(firstPlannedUtc);
  const source = operationalSource(plannerRun || stripInternalReference(reference), plannedPeriod);
  const period = plannedPeriod || explicitPeriod(source) || explicitPeriod(runType);
  return formatChoice(source, period, overnight ?? explicitOvernight(plannerNotes));
}

export function displayPlannerRunChoice(plannerRun?: string, runType?: string, fallbackReference?: string, firstPlannedUtc?: string, overnight?: boolean) {
  const plannedPeriod = periodFromPlannedUtc(firstPlannedUtc);
  const source = operationalSource(plannerRun?.trim() || (fallbackReference ? stripInternalReference(fallbackReference) : "TBC"), plannedPeriod);
  const period = plannedPeriod || explicitPeriod(source) || explicitPeriod(runType);
  return formatChoice(source, period, overnight ?? explicitOvernight(runType));
}
