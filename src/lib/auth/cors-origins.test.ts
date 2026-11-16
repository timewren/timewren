import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedCorsOrigin } from "./cors-origins";

afterEach(() => vi.unstubAllEnvs());

describe("isAllowedCorsOrigin", () => {
  it("keeps extension compatibility when the override is unset", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", undefined);
    expect(isAllowedCorsOrigin("chrome-extension://abc")).toBe(true);
    expect(isAllowedCorsOrigin("moz-extension://abc")).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example")).toBe(false);
    expect(isAllowedCorsOrigin(null)).toBe(false);
  });

  it("restricts to exact configured origins, without paths or wildcards", () => {
    vi.stubEnv(
      "CORS_ALLOWED_ORIGINS",
      "https://app.example.org, chrome-extension://abc, *, https://evil.example/path",
    );
    expect(isAllowedCorsOrigin("https://app.example.org")).toBe(true);
    expect(isAllowedCorsOrigin("chrome-extension://abc")).toBe(true);
    expect(isAllowedCorsOrigin("chrome-extension://other")).toBe(false);
    expect(isAllowedCorsOrigin("https://app.example.org.evil.test")).toBe(
      false,
    );
    expect(isAllowedCorsOrigin("https://evil.example/path")).toBe(false);
    expect(isAllowedCorsOrigin("null")).toBe(false);
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
    expect(isAllowedCorsOrigin("chrome-extension://abc")).toBe(false);
  });
});
