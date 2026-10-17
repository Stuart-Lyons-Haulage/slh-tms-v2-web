import { describe, expect, it } from "vitest";
import { DispatchSnapshotCache } from "./dispatchSnapshotCache";

describe("DispatchSnapshotCache", () => {
  it("reuses a warm date snapshot until its refresh window expires", () => {
    const cache = new DispatchSnapshotCache<{ drivers: string[] }>(300_000);
    const snapshot = { drivers: ["A"] };
    cache.set("tenant:user:2026-10-11", snapshot, 1_000);

    expect(cache.get("tenant:user:2026-10-11", 4_000)).toBe(snapshot);
    expect(cache.get("tenant:user:2026-10-11", 301_000)).toBeUndefined();
  });

  it("keeps dates and authenticated users isolated", () => {
    const cache = new DispatchSnapshotCache<string>(300_000);
    cache.set("tenant:user-a:2026-10-11", "A");
    cache.set("tenant:user-b:2026-10-11", "B");
    cache.set("tenant:user-a:2026-10-12", "C");

    expect(cache.get("tenant:user-a:2026-10-11")).toBe("A");
    expect(cache.get("tenant:user-b:2026-10-11")).toBe("B");
    expect(cache.get("tenant:user-a:2026-10-12")).toBe("C");
  });
});
