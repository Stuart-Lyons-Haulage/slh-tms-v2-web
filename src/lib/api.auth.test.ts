import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./api";

describe("API authorisation errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("surfaces API 403 responses as Microsoft sign-in succeeded but TMS access denied", async () => {
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
        "Microsoft sign-in worked, but your account has not been granted TMS API access yet.",
    } satisfies Partial<ApiError>);
  });
});
