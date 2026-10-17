export type PlannerCsvStop = {
  sequence: number;
  collectionSite?: string;
  deliverySite?: string;
  pallets?: number;
  reference?: string;
  palletType?: string;
  collectFrom?: string;
  collectTo?: string;
  deadline?: string;
  sourceRow: number;
  collectionDate?: string;
  deliveryDate?: string;
};

export type PlannerCsvRun = {
  runRef: string;
  plannerRun: string;
  runType?: "AM" | "PM";
  overnight?: boolean;
  planningDate: string;
  driver?: string;
  vehicle?: string;
  trailer?: string;
  plannerNote?: string;
  includeInImport: boolean;
  reconciliationStatus: string;
  capacityStatus: "Green" | "Amber" | "Red";
  mixedUtilisationPercent: number;
  source?: { workbook?: string; sheet?: string };
  stops: PlannerCsvStop[];
};

export type PlannerCsvPayload = {
  schema: string;
  planningDate: string;
  runs: PlannerCsvRun[];
  exceptions: Array<{ severity?: string; runRef?: string; code?: string; detail?: string }>;
};

type CsvRecord = Record<string, string> & { __row: string };

function clean(value: unknown) { return String(value ?? "").trim(); }
function key(value: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function parseRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; continue; }
      if (char === '"') { quoted = false; continue; }
      field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = []; field = "";
      continue;
    }
    field += char;
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function recordsFromCsv(text: string): CsvRecord[] {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error("The CSV contains no planner rows.");
  const headers = rows[0].map((header) => key(header));
  return rows.slice(1).map((values, index) => {
    const record: CsvRecord = { __row: String(index + 2) };
    headers.forEach((header, column) => { if (header) record[header] = clean(values[column]); });
    return record;
  });
}

function value(record: CsvRecord, ...names: string[]) {
  for (const name of names) {
    const found = clean(record[key(name)]);
    if (found) return found;
  }
  return "";
}

function isoDate(raw: string) {
  const value = clean(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const british = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (british) return `${british[3]}-${british[2].padStart(2, "0")}-${british[1].padStart(2, "0")}`;
  return "";
}

function time(raw: string) {
  const value = clean(raw);
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return value || undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function number(raw: string) {
  const parsed = Number(clean(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizedSite(value: string) { return clean(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }

function palletType(collection: string, delivery: string, unit: string) {
  const explicit = normalizedSite(unit);
  if (explicit === "STD" || explicit === "STANDARD") return "Standard";
  if (explicit === "EURO") return "Euro";
  if (explicit.includes("TRAY") || explicit.includes("CRATE")) return clean(unit) || undefined;

  const collect = normalizedSite(collection);
  const deliver = normalizedSite(delivery);
  if (deliver.includes("MORRISONS") || deliver.includes("WAITROSE")) return "Standard";
  if (deliver.includes("ALDI") && (collect.includes("BAR") || collect.includes("BARFOOT") || collect.includes("NWF") || collect.includes("NATURESWAY"))) return "Euro";
  if (collect.includes("LANGMEAD") || collect.startsWith("LAN")) return deliver.includes("ALDI") && deliver.includes("ATHERSTONE") ? "Euro" : "Standard";
  return undefined;
}

function capacity(stops: PlannerCsvStop[]) {
  let standard = 0, euro = 0, unknown = 0;
  for (const stop of stops) {
    const pallets = stop.pallets || 0;
    if (stop.palletType?.toLowerCase() === "standard") standard += pallets;
    else if (stop.palletType?.toLowerCase() === "euro") euro += pallets;
    else unknown += pallets;
  }
  const utilisation = standard / 26 + euro / 33;
  return {
    status: (unknown > 0 ? "Amber" : utilisation > 1 ? "Red" : "Green") as "Green" | "Amber" | "Red",
    percent: Math.round(utilisation * 1000) / 10,
  };
}

function naturalLoadNumber(left: string, right: string) {
  const a = Number(left), b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function runRef(planningDate: string, loadNumber: string) {
  const date = planningDate.replace(/-/g, "");
  const numeric = Number(loadNumber);
  if (Number.isFinite(numeric)) return `LYONS-${date}-RUN-${String(numeric).padStart(3, "0")}`;
  const safe = clean(loadNumber).toUpperCase().replace(/[^A-Z0-9_-]+/g, "-");
  return `LYONS-${date}-${safe}`;
}

function consistent(group: CsvRecord[], label: string, ...names: string[]) {
  const values = [...new Set(group.map((row) => value(row, ...names)).filter(Boolean))];
  if (values.length > 1) throw new Error(`Load ${value(group[0], "Load number", "Load")}: conflicting ${label} values (${values.join(", ")}).`);
  return values[0] || undefined;
}

export function parsePlannerCsv(text: string, fileName = "planner.csv"): PlannerCsvPayload {
  const records = recordsFromCsv(text);
  const required = ["Load number", "Collection", "Delivery", "Pallets", "Planned dispatch date"];
  const first = records[0];
  const missing = required.filter((column) => !Object.prototype.hasOwnProperty.call(first, key(column)));
  if (missing.length) throw new Error(`Planner CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);

  const dates = [...new Set(records.map((record) => isoDate(value(record, "Planned dispatch date", "Planning date"))).filter(Boolean))];
  if (dates.length !== 1) throw new Error(`Planner CSV must contain one Planned dispatch date; found ${dates.length || "none"}.`);
  const planningDate = dates[0];

  const grouped = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const load = value(record, "Load number", "Load", "Run number", "Run");
    if (!load) throw new Error(`CSV row ${record.__row} has no Load number.`);
    const date = isoDate(value(record, "Planned dispatch date", "Planning date"));
    if (date !== planningDate) throw new Error(`CSV row ${record.__row} uses planning date ${date || "unknown"}; expected ${planningDate}.`);
    grouped.set(load, [...(grouped.get(load) || []), record]);
  }

  const runs = [...grouped.entries()].sort(([a], [b]) => naturalLoadNumber(a, b)).map(([load, group]) => {
    const driver = consistent(group, "Driver", "Driver");
    const vehicle = consistent(group, "Vehicle", "Vehicle", "Registration");
    const trailer = consistent(group, "Trailer", "Trailer", "Trailer number");
    const source = consistent(group, "Plan source", "Plan source", "Source");
    const status = consistent(group, "Status", "Status");

    const preCollections: string[] = [];
    const stops = group.map((record, index): PlannerCsvStop => {
      const collection = value(record, "Collection", "Collection site");
      const delivery = value(record, "Delivery", "Delivery site", "Destination");
      const collectionDate = isoDate(value(record, "Collection date")) || planningDate;
      const deliveryDate = isoDate(value(record, "Due date", "Delivery date")) || planningDate;
      const collectFrom = time(value(record, "Collect from", "Collection from"));
      if (collectionDate !== planningDate) preCollections.push(`${collectionDate}${collectFrom ? ` ${collectFrom}` : ""} ${collection}`.trim());
      return {
        sequence: index + 1,
        collectionSite: collection || undefined,
        deliverySite: delivery || undefined,
        pallets: number(value(record, "Pallets", "Quantity")),
        reference: value(record, "PO", "PO number", "Order reference", "Reference") || undefined,
        palletType: palletType(collection, delivery, value(record, "Unit", "Pallet type")),
        collectFrom,
        collectTo: time(value(record, "Collect to", "Collection to")),
        deadline: time(value(record, "Deadline", "Deliver by")),
        sourceRow: Number(record.__row),
        collectionDate,
        deliveryDate,
      };
    });

    const planDayTimes = stops.filter((stop) => stop.collectionDate === planningDate).map((stop) => stop.collectFrom).filter((entry): entry is string => Boolean(entry)).sort();
    const allTimes = stops.map((stop) => stop.collectFrom).filter((entry): entry is string => Boolean(entry)).sort();
    const firstTime = (planDayTimes.length ? planDayTimes : allTimes)[0];
    const period: "AM" | "PM" | undefined = firstTime ? (Number(firstTime.slice(0, 2)) >= 12 ? "PM" : "AM") : undefined;
    const capacityResult = capacity(stops);
    const notes = [`CSV import from ${fileName}`, status ? `Source status: ${status}` : "", preCollections.length ? `Pre-collection(s): ${preCollections.join(", ")}` : ""].filter(Boolean);

    return {
      runRef: runRef(planningDate, load),
      plannerRun: /^\d+$/.test(load) ? `Run ${Number(load)}` : `Run ${load}`,
      runType: period,
      planningDate,
      driver,
      vehicle,
      trailer,
      plannerNote: notes.join(" | "),
      includeInImport: true,
      reconciliationStatus: "CSV direct import",
      capacityStatus: capacityResult.status,
      mixedUtilisationPercent: capacityResult.percent,
      source: { workbook: source || fileName, sheet: "Collection Plan CSV" },
      stops,
    };
  });

  return { schema: "slh-planner-plan-v1", planningDate, runs, exceptions: [] };
}
