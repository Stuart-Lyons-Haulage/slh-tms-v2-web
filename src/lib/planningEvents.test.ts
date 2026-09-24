import { afterEach, describe, expect, it, vi } from "vitest";
import { connectPlanningEventStream } from "./planningEvents";

describe("planning event stream authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("obtains a fresh token for each reconnect attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const getAccessToken = vi.fn()
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");

    const fetchMock = vi.fn().mockImplementation(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const disconnect = connectPlanningEventStream(getAccessToken);
    await vi.advanceTimersByTimeAsync(0);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer token-1");

    await vi.advanceTimersByTimeAsync(3000);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer token-2");

    disconnect();
  });

  it("reports token acquisition failures to the authentication callback", async () => {
    vi.useFakeTimers();
    const error = new Error("Your TMS sign-in has expired. Please sign in again.");
    const onAuthenticationRequired = vi.fn();
    const disconnect = connectPlanningEventStream(
      vi.fn().mockRejectedValue(error),
      { onAuthenticationRequired },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthenticationRequired).toHaveBeenCalledWith(error);
    disconnect();
  });
});
