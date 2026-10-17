import { describe, expect, it } from "vitest";
import { cacheLocationForRoute, isPublicTvLink, isTvRoute } from "./tvBootstrap";
import { clearDisplayKey, readStoredDisplayKey, storeDisplayKey } from "./pages/publicTvStorage";

describe("TV bootstrap contract", () => {
  it("recognises every public TV entry point and keeps TV auth in memory", () => {
    expect(isTvRoute("/tv")).toBe(true);
    expect(isTvRoute("/operations-wallboard/tv")).toBe(true);
    expect(isTvRoute("/live-runs/tv")).toBe(true);
    expect(isTvRoute("/operations-wallboard")).toBe(false);
    expect(isPublicTvLink("/tv", "?key=display-key")).toBe(true);
    expect(isPublicTvLink("/tv", "")).toBe(false);
    expect(cacheLocationForRoute("/tv")).toBe("memoryStorage");
    expect(cacheLocationForRoute("/dashboard")).toBe("sessionStorage");
  });

  it("does not let restricted TV storage prevent the pairing screen", () => {
    const restrictedStorage = {
      getItem: () => { throw new Error("Storage is disabled"); },
      setItem: () => { throw new Error("Storage is disabled"); },
      removeItem: () => { throw new Error("Storage is disabled"); },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: restrictedStorage });

    expect(readStoredDisplayKey()).toBe("");
    expect(() => storeDisplayKey("display-key")).not.toThrow();
    expect(() => clearDisplayKey()).not.toThrow();
  });
});
