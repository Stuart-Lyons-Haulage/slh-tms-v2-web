import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("../../pages/DriverDispatchOperational.tsx", import.meta.url), "utf8");

describe("Dispatch execution ownership", () => {
  it("keeps Dispatch capacity allocation and Samsara handover but no live vehicle-position backload feed", () => {
    expect(shellSource).toContain("<DispatchBoard");
    expect(shellSource).not.toContain("<BackloadMatchNotifications");
    expect(shellSource).not.toContain("BackloadMatchNotifications");
    expect(shellSource).not.toContain("<DriverDispatch />");
  });
});
