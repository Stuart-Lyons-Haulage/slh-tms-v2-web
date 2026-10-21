import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("order intake control centre wiring", () => {
  it("exposes reconciliation, evidence and export controls from Orders", () => {
    const page = readFileSync(new URL("./pages/OrderControl.tsx", import.meta.url), "utf8");
    const control = readFileSync(new URL("./components/OrderIntakeControlCentre.tsx", import.meta.url), "utf8");
    expect(page).toContain("OrderIntakeControlCentre");
    expect(page).toContain('setTab("control")');
    expect(control).toContain("/api/v1/order-intake/control-centre");
    expect(control).toContain("SourceEmailEvidenceDrawer");
    expect(control).toContain("Excel reconciliation");
  });
});
