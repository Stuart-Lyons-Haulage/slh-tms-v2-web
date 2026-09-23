import { parsePlannerCsv, type PlannerCsvPayload } from "./plannerCsvImport";
import {
  isLyonsCollectionsWorkbook,
  lyonsCollectionsWorkbookToPayload,
} from "./lyonsCollectionsWorkbook";
import {
  isLyonsSouthboundWorkbook,
  southboundWorkbookToPayload,
  type WorkbookSheetRows,
} from "./southboundWorkbook";

const workbookExtension = /\.(xlsx|xls|xlsm)$/i;

async function workbookRows(file: File): Promise<WorkbookSheetRows> {
  const XLSX = await import("xlsx");
  // Keep Excel dates/times as serial values. Converting workbook dates to JavaScript Date
  // objects first can shift midnight back one calendar day in BST when later normalised via UTC.
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: true });
  const sheets: WorkbookSheetRows = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    sheets[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  }
  return sheets;
}

export async function parsePlannerPlanFile(file: File): Promise<PlannerCsvPayload> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parsePlannerCsv(await file.text(), file.name);
  }
  if (!workbookExtension.test(file.name)) {
    throw new Error("Planning file format not recognised. Upload CSV, XLSX, XLS or XLSM.");
  }

  const sheets = await workbookRows(file);

  // Detection order is deliberate: Southbound is not a Lyons Collection Plan and must
  // never fall through to the generic planner-column scanner.
  if (isLyonsSouthboundWorkbook(sheets)) return southboundWorkbookToPayload(sheets, file.name);
  if (isLyonsCollectionsWorkbook(sheets)) return lyonsCollectionsWorkbookToPayload(sheets, file.name);

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: false });
  const rejectedSheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    try {
      return parsePlannerCsv(csv, `${file.name} · ${sheetName}`);
    } catch (error) {
      rejectedSheets.push(`${sheetName}: ${error instanceof Error ? error.message : "not a recognised planner sheet"}`);
    }
  }

  throw new Error(
    `No supported planning layout was found in ${file.name}.${rejectedSheets.length ? ` Checked: ${rejectedSheets.join(" | ")}` : ""}`
  );
}

export async function parsePlannerPlanFiles(files: File[]): Promise<PlannerCsvPayload> {
  if (!files.length) throw new Error("Choose at least one planning workbook.");
  const payloads = await Promise.all(files.map(parsePlannerPlanFile));
  const dates = [...new Set(payloads.map(payload => payload.planningDate))];
  if (dates.length !== 1) {
    throw new Error(`Planning workbooks must be for the same date; found ${dates.join(", ")}.`);
  }

  const seen = new Set<string>();
  const runs = payloads.flatMap(payload => payload.runs).map(run => {
    let runRef = run.runRef;
    let suffix = 2;
    while (seen.has(runRef)) runRef = `${run.runRef}-${suffix++}`;
    seen.add(runRef);
    return runRef === run.runRef ? run : { ...run, runRef };
  });

  return {
    schema: "slh-planner-plan-v1",
    planningDate: dates[0],
    runs,
    exceptions: payloads.flatMap(payload => payload.exceptions),
  };
}
