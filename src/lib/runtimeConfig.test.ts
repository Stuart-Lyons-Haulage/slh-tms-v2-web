import { describe, expect, it } from "vitest";
import { normaliseApiBaseUrl } from "./runtimeConfig";

describe("API base URL configuration", () => {
  it("accepts same-origin paths and removes a trailing slash", () => {
    expect(normaliseApiBaseUrl("/tms-api/")).toBe("/tms-api");
  });

  it("accepts absolute HTTP(S) API URLs", () => {
    expect(normaliseApiBaseUrl("https://api.example.com/tms/")).toBe("https://api.example.com/tms");
    expect(normaliseApiBaseUrl("http://localhost:5080/")).toBe("http://localhost:5080");
  });

  it("rejects executable or protocol-relative URLs", () => {
    expect(() => normaliseApiBaseUrl("javascript:alert(1)")).toThrow(/http: or https:/i);
    expect(() => normaliseApiBaseUrl("//evil.example/tms")).toThrow(/same-origin path or an absolute HTTP\(S\) URL/i);
  });

  it("rejects credentials, query strings and fragments", () => {
    expect(() => normaliseApiBaseUrl("https://user:pass@example.com/tms")).toThrow(/must not contain/i);
    expect(() => normaliseApiBaseUrl("https://example.com/tms?mode=unsafe")).toThrow(/must not contain/i);
    expect(() => normaliseApiBaseUrl("https://example.com/tms#fragment")).toThrow(/must not contain/i);
  });
});
