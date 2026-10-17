import { describe, expect, it } from "vitest";
import { parsePlannerCsv } from "./plannerCsvImport";

describe("parsePlannerCsv", () => {
  it("groups source lines into runs and preserves cross-day collection dates", () => {
    const csv = [
      "Load number,Due date,Status,Customer / source,Collection,Delivery,Pallets,Unit,Driver,Vehicle,Trailer,Collect from,Collect to,Deadline,Collection date,Planned dispatch date,Plan source,Inbox source,Notes",
      "2,2026-08-28,Planned / Test,Aldi,GHS-Greenhouse Growers (Eric Wall),Aldi-Darlington,2,Pallets,John Brookes,FZS,14,17:00:00,18:00:00,18:00:00,2026-08-27,2026-08-28,Lyons collections 280826.xlsm – Collection Plan,,load from coldstore",
      "2,2026-08-28,Planned / Test,Aldi,NWF-Runcton,Aldi-Darlington,12,Pallets,John Brookes,FZS,14,04:30:00,05:00:00,18:00:00,2026-08-28,2026-08-28,Lyons collections 280826.xlsm – Collection Plan,,",
      "3,2026-08-28,Planned / Test,Aldi,NWF-Merston,Aldi-Goldthorpe,11,Pallets,Karol Golaszewski,UJO,08,04:00:00,05:00:00,18:00:00,2026-08-28,2026-08-28,Lyons collections 280826.xlsm – Collection Plan,,",
    ].join("\n");

    const payload = parsePlannerCsv(csv, "test.csv");

    expect(payload.planningDate).toBe("2026-08-28");
    expect(payload.runs).toHaveLength(2);
    expect(payload.runs[0].runRef).toBe("LYONS-20260828-RUN-002");
    expect(payload.runs[0].plannerRun).toBe("Run 2");
    expect(payload.runs[0].runType).toBe("AM");
    expect(payload.runs[0].stops).toHaveLength(2);
    expect(payload.runs[0].stops[0].collectionDate).toBe("2026-08-27");
    expect(payload.runs[0].stops[1].collectFrom).toBe("04:30");
    expect(payload.runs[0].plannerNote).toContain("Pre-collection(s): 2026-08-27 17:00 GHS-Greenhouse Growers (Eric Wall)");
    expect(payload.runs[1].runRef).toBe("LYONS-20260828-RUN-003");
  });

  it("rejects a CSV that mixes planning dates", () => {
    const csv = [
      "Load number,Collection,Delivery,Pallets,Planned dispatch date",
      "1,NWF-Selsey,Aldi-Darlington,29,2026-08-28",
      "2,NWF-Runcton,Aldi-Darlington,12,2026-08-29",
    ].join("\n");

    expect(() => parsePlannerCsv(csv)).toThrow(/one Planned dispatch date/i);
  });
});
