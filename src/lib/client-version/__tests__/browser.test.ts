import { describe, expect, it } from "vitest";
import {
  isClientTooOldClientError,
  webClientHeaders,
  webClientVersion,
} from "../browser";
import { parseClientHeader } from "../index";

describe("web-klientens header", () => {
  it("bruger de første 12 tegn af build-SHA'en, ellers dev", () => {
    expect(webClientVersion("e64648eaabcdef0123456789")).toBe("e64648eaabcd");
    expect(webClientVersion(null)).toBe("dev");
  });

  it("headeren kan parses af serveren", () => {
    const value = webClientHeaders()["x-timetrack-client"];
    expect(parseClientHeader(value)?.kind).toBe("web");
  });
});

describe("isClientTooOldClientError", () => {
  it("genkender appCode fra serveren", () => {
    expect(
      isClientTooOldClientError({ data: { appCode: "CLIENT_TOO_OLD" } }),
    ).toBe(true);
    expect(isClientTooOldClientError({ data: { code: "FORBIDDEN" } })).toBe(
      false,
    );
    expect(isClientTooOldClientError(null)).toBe(false);
    expect(isClientTooOldClientError(new Error("x"))).toBe(false);
  });
});
