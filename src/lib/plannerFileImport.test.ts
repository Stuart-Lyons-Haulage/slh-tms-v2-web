import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parsePlannerPlanFile } from "./plannerFileImport";

const rows = [
  ["Load number", "Collection", "Delivery", "Pallets", "Planned dispatch date", "PO"],
  ["1", "Runcton", "Leeds", "9", "09/09/2026", "PO-7788"],
];

function workbookFile(name = "Lyons Collections.xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"], ["Not the planner sheet"]]), "Cover");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Collections");
  const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => data as ArrayBuffer,
    text: async () => "",
  } as File;
}

describe("parsePlannerPlanFile", () => {
  it("finds the Lyons planner sheet inside a normal Excel workbook", async () => {
    const payload = await parsePlannerPlanFile(workbookFile());
    expect(payload.planningDate).toBe("2026-09-09");
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].plannerRun).toBe("Run 1");
    expect(payload.runs[0].stops[0]).toMatchObject({
      collectionSite: "Runcton",
      deliverySite: "Leeds",
      pallets: 9,
      reference: "PO-7788",
    });
  });

  it("keeps the planners' AM and PM/O/N split and retains required PM board work", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [null, null, null, null, null, null, "DATE:", 46277],
      ["SOUTHBOUNDS"],
      [],
      ["JOB NR.", "Collection site", "Delivery site", "Reference", "Tip date", "Coll Time:", "Planner note:", "DRIVER"],
      [],
      ["S1", "Doncaster Europool Traywash", "Selsey", "228325128", 46278, "06:30/07:00", "", "Brian Fowler"],
    ]), "Southbound");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [], ["Waitrose North"], [], ["Grower A", "PO-AM-1"],
    ]), "WAVE 1");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [], ["Waitrose South"], [], ["Grower B", "PO-PM-1"],
    ]), "WAVE 3");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [], [], [null, "Collection Required", "Collection", "Pallets / Trollies", "Planned"],
      [null, "Yes", "Barfoots Sefter Wave 1", 3, "Kevin Jeffery"],
    ]), "Collection Board");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const payload = await parsePlannerPlanFile({
      name: "New Southbound Sheet.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      arrayBuffer: async () => data as ArrayBuffer,
      text: async () => "",
    } as File);

    expect(payload.runs.some(run => run.plannerRun.startsWith("Waitrose") && run.runType === "AM" && !/WAVE/i.test(run.plannerRun))).toBe(true);
    expect(payload.runs.some(run => run.plannerRun.startsWith("Waitrose") && run.runType === "PM" && run.overnight && !/WAVE/i.test(run.plannerRun))).toBe(true);
    const overnightWaitrose = payload.runs.find(run => run.plannerRun.startsWith("Waitrose") && run.runType === "PM");
    expect(overnightWaitrose?.stops[0].deliveryDate).toBe("2026-09-13");
    const collectionBoard = payload.runs.find(run => run.plannerRun === "PM-4");
    expect(collectionBoard).toMatchObject({ runType: "PM", overnight: true });
    expect(collectionBoard?.stops[0]).toMatchObject({ collectionSite: "Barfoots Sefter", deliveryDate: "2026-09-13" });
    expect(collectionBoard?.plannerNote).not.toMatch(/WAVE/i);
    expect(payload.exceptions.some(exception => exception.code === "CollectionBoardNeedsCompletion")).toBe(true);
  });
});
