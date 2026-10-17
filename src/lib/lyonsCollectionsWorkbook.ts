import { type PlannerCsvPayload, type PlannerCsvRun, type PlannerCsvStop } from "./plannerCsvImport";
import type { WorkbookSheetRows } from "./southboundWorkbook";

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const us = text.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return "";
}

function time(value: unknown): string | undefined {
  if (value instanceof Date) return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
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

export function isLyonsCollectionsWorkbook(sheets: WorkbookSheetRows): boolean {
  const rows = sheets["Collection Plan"];
  if (!rows) return false;
  return rows.slice(0, 8).some(row => {
    const labels = row.map(key);
    return labels.includes("loadnumber") && labels.includes("collectionsite") && labels.includes("deliverydestination") && labels.some(label => label.startsWith("palletsordered"));
  });
}

export function lyonsCollectionsWorkbookToPayload(sheets: WorkbookSheetRows, fileName = "Lyons Collections workbook"): PlannerCsvPayload {
  const rows = sheets["Collection Plan"];
  if (!rows) throw new Error(`${fileName} does not contain the Collection Plan sheet.`);

  let headerIndex = -1;
  for (let index = 0; index < Math.min(rows.length, 10); index++) {
    const labels = rows[index].map(key);
    if (labels.includes("loadnumber") && labels.includes("collectionsite") && labels.includes("deliverydestination") && labels.some(label => label.startsWith("palletsordered"))) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) throw new Error(`${fileName} Collection Plan header was not found.`);

  const header = rows[headerIndex].map(key);
  const col = (...names: string[]) => {
    const normalized = names.map(name => key(name));
    return header.findIndex(label => normalized.some(name => label === name || label.startsWith(name)));
  };
  const loadCol = col("Load Number");
  const collectionCol = col("Collection Site");
  const deliveryCol = col("Delivery Destination");
  const palletsCol = col("Pallets Ordered");
  const driverCol = col("Driver");
  const vehicleCol = col("Vehicle");
  const trailerCol = col("Trailer");
  const noteCol = col("Notes");
  const fromCol = col("Planned Collect Time From");
  const toCol = col("Planned Collect Time To");
  const deadlineCol = col("Deadline Time");
  const collectionDateCol = col("Collection Site Arr Date", "Collection Date");

  const planningDate = excelDate(rows[1]?.[5]) || rows.slice(0, headerIndex).flat().map(excelDate).find(Boolean) || "";
  if (!planningDate) throw new Error(`${fileName} Collection Plan does not contain a readable planning date.`);

  const grouped = new Map<string, unknown[][]>();
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const load = clean(row?.[loadCol]);
    const collection = clean(row?.[collectionCol]);
    const delivery = clean(row?.[deliveryCol]);
    const pallets = numberFrom(row?.[palletsCol]);
    if (!load || !collection || !delivery || !pallets || pallets <= 0) continue;
    grouped.set(load, [...(grouped.get(load) || []), row]);
  }

  if (!grouped.size) throw new Error("Collection Plan contains no positive-pallet load rows.");

  const runs: PlannerCsvRun[] = [...grouped.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([load, group]) => {
    let sourceRow = headerIndex + 2;
    const stops: PlannerCsvStop[] = group.map(row => ({
      sequence: sourceRow,
      collectionSite: clean(row[collectionCol]) || undefined,
      deliverySite: clean(row[deliveryCol]) || undefined,
      pallets: numberFrom(row[palletsCol]),
      reference: clean(row[noteCol]) || undefined,
      collectFrom: time(row[fromCol]),
      collectTo: time(row[toCol]),
      deadline: time(row[deadlineCol]),
      sourceRow: sourceRow++,
      collectionDate: excelDate(row[collectionDateCol]) || planningDate,
      deliveryDate: planningDate,
    }));
    const first = stops.map(stop => stop.collectFrom).filter(Boolean).sort()[0];
    const hour = first ? Number(first.slice(0, 2)) : 0;
    const total = stops.reduce((sum, stop) => sum + (stop.pallets ?? 0), 0);
    const overnight = stops.some(stop => stop.collectionDate !== planningDate || stop.deliveryDate !== planningDate);
    return {
      runRef: `LYONS-${planningDate.replace(/-/g, "")}-RUN-${String(load).padStart(3, "0")}`,
      plannerRun: `Run ${Number(load) || load}`,
      runType: hour >= 17 ? "PM" : "AM",
      overnight,
      planningDate,
      driver: clean(group[0]?.[driverCol]) || undefined,
      vehicle: clean(group[0]?.[vehicleCol]) || undefined,
      trailer: clean(group[0]?.[trailerCol]) || undefined,
      plannerNote: `Collection Plan import from ${fileName}${overnight ? " | O/N: Yes" : ""}`,
      includeInImport: true,
      reconciliationStatus: "Collection Plan direct import",
      capacityStatus: total > 33 ? "Red" : total > 26 ? "Amber" : "Green",
      mixedUtilisationPercent: Math.round(total / 26 * 1000) / 10,
      source: { workbook: fileName, sheet: "Collection Plan" },
      stops,
    };
  });

  return { schema: "slh-planner-plan-v1", planningDate, runs, exceptions: [] };
}
