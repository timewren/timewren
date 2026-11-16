import { describe, expect, it } from "vitest";
import { readRememberedValue } from "../useRememberedState";

const SORTS = ["status", "remaining", "name"] as const;

describe("readRememberedValue", () => {
  it("bruger den gemte værdi, når den er tilladt", () => {
    expect(readRememberedValue("remaining", SORTS, "status")).toBe("remaining");
  });

  it("falder tilbage, når intet er gemt", () => {
    expect(readRememberedValue(null, SORTS, "status")).toBe("status");
  });

  it("falder tilbage ved en ukendt eller forældet værdi", () => {
    expect(readRememberedValue("expiry-old", SORTS, "status")).toBe("status");
    expect(readRememberedValue("", SORTS, "status")).toBe("status");
  });
});
