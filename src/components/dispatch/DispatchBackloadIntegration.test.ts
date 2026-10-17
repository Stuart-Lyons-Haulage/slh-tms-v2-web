import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("../../pages/DriverDispatchOperational.tsx", import.meta.url), "utf8");

describe("authoritative Dispatch backload integration", () => {
  it("keeps live backload opportunities on the authoritative Dispatch page without restoring the legacy table", () => {
    expect(shellSource).toContain('import { BackloadMatchNotifications } from "../components/BackloadMatchNotifications";');
    expect(shellSource).toContain("<BackloadMatchNotifications />");
    expect(shellSource).toContain("<DispatchBoard");
    expect(shellSource).not.toContain("<DriverDispatch />");
  });
});
