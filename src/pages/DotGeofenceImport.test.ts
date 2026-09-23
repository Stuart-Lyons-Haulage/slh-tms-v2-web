import { describe, expect, it } from "vitest";
import { filterImportSites, importRowsReady, type DotImportDecision, type DotImportRow } from "./DotGeofenceImportLogic";

describe("DOT geofence import review", () => {
  it("finds active Sites by code or a differently worded name", () => {
    const sites = [
      { id: "1", externalCode: "SITE023", name: "Barfoots Sefter", active: true },
      { id: "2", externalCode: "SITE024", name: "Aldi Cardiff", active: true },
      { id: "3", externalCode: "SITE025", name: "Archived", active: false },
    ];

    expect(filterImportSites(sites, "barfoot")).toEqual([sites[0]]);
    expect(filterImportSites(sites, "site024")).toEqual([sites[1]]);
    expect(filterImportSites(sites, "")).toEqual(sites.slice(0, 2));
  });

  it("requires every selected unresolved or possible-rename row to be explicitly resolved", () => {
    const rows: DotImportRow[] = [
      { clientKey: "MATCH", name: "Match", status: "Matched", suggestedSiteId: "1" },
      { clientKey: "UPDATE", name: "Update", status: "AlreadyImported", suggestedSiteId: "1" },
      { clientKey: "UNMATCHED", name: "Different DOT Name", status: "NeedsLinking" },
      { clientKey: "RENAMED", name: "Renamed", status: "PossibleRename", possibleRenameGeofenceId: "g1" },
      { clientKey: "BAD", name: "Bad", status: "Invalid" },
    ];
    const incomplete: Record<string, DotImportDecision> = {
      MATCH: { siteId: "1" },
      UPDATE: { siteId: "1" },
      UNMATCHED: { siteId: "2" },
      RENAMED: { siteId: "1" },
      BAD: { skip: true },
    };
    expect(importRowsReady(rows, incomplete)).toBe(false);

    const complete = {
      ...incomplete,
      RENAMED: { siteId: "1", confirmRenameGeofenceId: "g1" },
    };
    expect(importRowsReady(rows, complete)).toBe(true);
  });

  it("allows an operator to skip an unmatched row", () => {
    const rows: DotImportRow[] = [{ clientKey: "SKIP", name: "Skip", status: "NeedsLinking" }];
    expect(importRowsReady(rows, { SKIP: { skip: true } })).toBe(true);
  });
});
