import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./api";

describe("API authorisation errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("surfaces API 403 responses as TMS permission denied", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(request("/api/v1/customers", "token")).rejects.toMatchObject({
      status: 403,
      message:
        "Your account does not have permission to perform this TMS action.",
    } satisfies Partial<ApiError>);
  });
});
