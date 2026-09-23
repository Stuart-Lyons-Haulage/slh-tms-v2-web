import { type PlannerCsvPayload, type PlannerCsvRun, type PlannerCsvStop } from "./plannerCsvImport";

export type WorkbookRows = unknown[][];
export type WorkbookSheetRows = Record<string, WorkbookRows>;

type Exception = PlannerCsvPayload["exceptions"][number];

const clean = (value: unknown) => String(value ?? "").trim();
const norm = (value: unknown) => clean(value).toUpperCase().replace(/\s+/g, " ");
const plannerSiteName = (value: unknown) => clean(value)
  .replace(/\s+wave\s*\d+\b/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return utc.toISOString().slice(0, 10);
  }
  const text = clean(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (uk) {
    const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${year}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }
  return "";
}

function time(value: unknown): string | undefined {
  if (value instanceof Date) return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = clean(value).match(/\b(\d{1,2}):(\d{2})\b/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = clean(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function unitFromText(text: string): string | undefined {
  const value = norm(text);
  if (value.includes("TROLL")) return "Trollies";
  if (value.includes("DOLAV")) return "Dolavs";
  if (value.includes("CRATE")) return "Crates";
  if (value.includes("TRAY")) return "Trays";
  if (value.includes("PACKAG")) return "Packaging";
  if (value.includes("MARKET")) return "Market";
  return undefined;
}

function run(
  planningDate: string,
  ref: string,
  stops: PlannerCsvStop[],
  note: string,
  driver?: string,
  period?: "AM" | "PM",
  sourceSheet = "Southbound",
): PlannerCsvRun {
  const total = stops.reduce((sum, stop) => sum + (stop.pallets ?? 0), 0);
  const first = stops.map(stop => stop.collectFrom).find(Boolean);
  const hour = first ? Number(first.slice(0, 2)) : 0;
  const overnight = stops.some(stop => stop.collectionDate !== planningDate || stop.deliveryDate !== planningDate) || (period === "PM" && /overnight|o\/n/i.test(note));
  return {
    runRef: `SOUTH-${planningDate.replace(/-/g, "")}-${period || (hour >= 17 ? "PM" : "AM")}-${ref.replace(/[^A-Za-z0-9_-]+/g, "-")}`,
    plannerRun: ref,
    runType: period || (overnight ? "PM" : hour >= 17 ? "PM" : "AM"),
    overnight,
    planningDate,
    driver,
    plannerNote: note,
    includeInImport: true,
    reconciliationStatus: "Southbound workbook evidence",
    capacityStatus: "Amber",
    mixedUtilisationPercent: total > 0 ? Math.round(total / 26 * 1000) / 10 : 0,
    source: { workbook: "Southbound", sheet: sourceSheet },
    stops,
  };
}

function splitDelivery(value: string): string[] {
  return value.split(/\s*\/\s*|\s*,\s*|\s+and\s+/i).map(clean).filter(Boolean);
}

function allocations(note: string, destinations: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const destination of destinations) {
    const token = destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const short = destination.replace(/[^A-Za-z0-9]/g, "").slice(0, 5);
    const patterns = [new RegExp(`${token}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:p|plt|pallet)`, "i")];
    if (short.length >= 3) patterns.push(new RegExp(`${short}[A-Za-z]*\\s*(\\d+(?:\\.\\d+)?)\\s*(?:p|plt|pallet)`, "i"));
    for (const pattern of patterns) {
      const match = note.match(pattern);
      if (match) { result.set(destination, Number(match[1])); break; }
    }
  }
  if (destinations.length === 1 && !result.has(destinations[0])) {
    const match = note.match(/\b(\d+(?:\.\d+)?)\s*(?:p|plt|pallet)s?\b/i);
    if (match) result.set(destinations[0], Number(match[1]));
  }
  return result;
}

function parseTransfer(text: string): { legs: Array<[string, string]>; unit?: string } | undefined {
  const raw = clean(text).replace(/\s+/g, " ");
  if (!raw) return undefined;
  const round = raw.match(/^(.+?)\s+-\s+(.+?)\s+-\s+\1(?:\s+|$)/i);
  if (round) return { legs: [[clean(round[1]), clean(round[2])], [clean(round[2]), clean(round[1])]], unit: unitFromText(raw) };
  const fromTo = raw.match(/(?:^|\b)from\s+(.+?)\s+to\s+(.+?)(?=\s+(?:load|tip|deliver|ready|after|am|pm|wed|thu|fri|sat|sun|mon|tue)\b|$)/i);
  if (fromTo) return { legs: [[clean(fromTo[1]), clean(fromTo[2])]], unit: unitFromText(raw) };
  const simple = raw.match(/^(.+?)\s+to\s+(.+?)(?=\s+(?:load|tip|deliver|ready|after|am|pm|wed|thu|fri|sat|sun|mon|tue)\b|$)/i);
  if (simple) return { legs: [[clean(simple[1]), clean(simple[2])]], unit: unitFromText(raw) };
  return undefined;
}

export function isLyonsSouthboundWorkbook(sheets: WorkbookSheetRows): boolean {
  const south = sheets["Southbound"];
  if (!south) return false;
  const marker = south.slice(0, 10).flat().some(value => norm(value).includes("SOUTHBOUNDS"));
  return marker && (Boolean(sheets["Collection Board"]) || Boolean(sheets["WAVE 3"]));
}

export function southboundWorkbookToPayload(sheets: WorkbookSheetRows, fileName = "Southbound workbook"): PlannerCsvPayload {
  if (!isLyonsSouthboundWorkbook(sheets)) throw new Error(`${fileName} is not recognised as the Lyons Southbound workbook.`);
  const south = sheets["Southbound"];
  const planningDate = excelDate(south?.[0]?.[7]);
  if (!planningDate) throw new Error(`${fileName} does not contain a readable planning date in Southbound!H1.`);

  const runs: PlannerCsvRun[] = [];
  const exceptions: Exception[] = [];
  let sourceRow = 1;

  for (let index = 5; index < (south?.length ?? 0); index++) {
    const row = south[index] ?? [];
    const job = clean(row[0]);
    const collection = plannerSiteName(row[1]);
    const deliveryText = clean(row[2]);
    if (/^S\d+/i.test(job) && collection && deliveryText) {
      const reference = clean(row[3]) || job;
      const note = clean(row[6]);
      const destinations = splitDelivery(deliveryText);
      const qty = allocations(note, destinations);
      const collectFrom = time(row[5]);
      const stops = destinations.map((delivery): PlannerCsvStop => ({
        sequence: ++sourceRow,
        collectionSite: collection,
        deliverySite: delivery,
        pallets: qty.get(delivery),
        reference,
        palletType: unitFromText(`${note} ${collection} ${delivery}`),
        collectFrom,
        sourceRow,
        collectionDate: planningDate,
        deliveryDate: excelDate(row[4]) || planningDate,
      }));
      runs.push(run(planningDate, job.trim(), stops, `Southbound ${job} from ${fileName}${note ? ` | ${note}` : ""}`, clean(row[7]) || undefined));
    }

    const transferRef = clean(row[16]);
    const transferText = clean(row[17]);
    if (/^T\d+/i.test(transferRef) && transferText) {
      const parsed = parseTransfer(transferText);
      if (!parsed) {
        exceptions.push({ severity: "warning", runRef: transferRef, code: "SouthboundTransferNeedsReview", detail: `Could not safely identify both endpoints: ${transferText}` });
      } else {
        parsed.legs.forEach((leg, legIndex) => {
          const [collectionSite, deliverySite] = leg;
          const qty = numberFrom(transferText.match(/\b\d+(?:\.\d+)?\s*(?:p|plt|pallet)/i)?.[0]);
          const stop: PlannerCsvStop = {
            sequence: ++sourceRow,
            collectionSite,
            deliverySite,
            pallets: qty,
            reference: transferRef,
            palletType: parsed.unit,
            collectFrom: time(transferText),
            sourceRow,
            collectionDate: planningDate,
            deliveryDate: planningDate,
          };
          runs.push(run(planningDate, parsed.legs.length > 1 ? `${transferRef}.${legIndex + 1}` : transferRef, [stop], `Transfer/outbound: ${transferText}`, clean(row[18]) || undefined));
        });
      }
    }
  }

  // Normalize the workbook source tabs to the planner-facing AM/PM model.
  const destinationColumns = [0, 5, 10, 15];
  for (const wave of [
    { sheet: "WAVE 1", period: "AM" as const, label: "AM" },
    { sheet: "WAVE 3", period: "PM" as const, label: "PM O/N" },
  ]) {
    const rows = sheets[wave.sheet] ?? [];
    const sections = [{ header: 1, start: 3, end: 18 }, { header: 18, start: 20, end: rows.length }];
    for (const section of sections) {
      for (const column of destinationColumns) {
        const destination = clean(rows[section.header]?.[column]);
        if (!destination) continue;
        const stops: PlannerCsvStop[] = [];
        for (let index = section.start; index < Math.min(section.end, rows.length); index++) {
          const supplier = clean(rows[index]?.[column]);
          const po = clean(rows[index]?.[column + 1]);
          if (!supplier || !po || norm(supplier) === "SUPPLIER") continue;
          if (/^\d+(?:\.\d+)?$/.test(supplier) && !/[A-Za-z]/.test(po)) continue;
          stops.push({
            sequence: ++sourceRow,
            collectionSite: plannerSiteName(supplier),
            deliverySite: `Waitrose ${destination}`,
            reference: po,
            palletType: "Market",
            sourceRow,
            collectionDate: planningDate,
            deliveryDate: wave.period === "PM" ? addDays(planningDate, 1) : planningDate,
          });
        }
        if (stops.length) {
          runs.push(run(
            planningDate,
            `Waitrose ${destination}`,
            stops,
            `${wave.label} Waitrose ${destination}; ${stops.length} PO line(s) retained from ${fileName}.`,
            undefined,
            wave.period,
            wave.sheet,
          ));
        }
      }
    }
  }

  const currentMarketSheets = Object.entries(sheets).filter(([name, rows]) => /^(Covent|Spit|Spitalfields|Western|West 3|Brighton)/i.test(name) && rows.some(row => row.some(value => excelDate(value) === planningDate)));
  if (currentMarketSheets.length === 0) {
    const board = sheets["Collection Board"] ?? [];
    for (let index = 3; index < board.length; index++) {
      const required = norm(board[index]?.[1]);
      const description = clean(board[index]?.[2]);
      if (required !== "YES") continue;
      const collection = description.replace(/\s+market.*$/i, "").trim();
      const qty = numberFrom(board[index]?.[3]);
      const ref = `PM-${index + 1}`;
      const stop: PlannerCsvStop = {
        sequence: ++sourceRow,
        collectionSite: plannerSiteName(collection || description),
        deliverySite: "Collection Board · destination TBC",
        pallets: qty && qty > 0 ? qty : undefined,
        palletType: "Market",
        reference: ref,
        sourceRow,
        collectionDate: planningDate,
        deliveryDate: addDays(planningDate, 1),
      };
      const planned = clean(board[index]?.[4]);
      const namedDriver = planned && !/^(on route|night driver|driver informed|collected|on site)$/i.test(planned) ? planned : undefined;
      runs.push(run(planningDate, ref, [stop], `PM O/N · Collection Board: ${plannerSiteName(description)}. Destination/stall and explicit collection window require completion before dispatch.`, namedDriver, "PM", "Collection Board"));
      exceptions.push({ severity: "warning", runRef: ref, code: "CollectionBoardNeedsCompletion", detail: `${description}: PM board item retained, but destination/stall and current-day timing evidence are unavailable.` });
    }
    if (Object.keys(sheets).some(name => /^(Covent|Spit|Spitalfields|Western|West 3|Brighton)/i.test(name))) {
      exceptions.push({ severity: "warning", code: "StaleMarketSheetIgnored", detail: `Detailed market tabs were not dated ${planningDate}, so they were not treated as current work.` });
    }
  }

  if (!runs.length) throw new Error(`${fileName} was recognised as Southbound but no safe current-day movements could be extracted.`);
  return { schema: "slh-planner-plan-v1", planningDate, runs, exceptions };
}
