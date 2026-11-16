import { describe, expect, it } from "vitest";
import { getTabId, sanitizeTabId } from "../tab-id";

describe("tab-id", () => {
  it("er stabilt i samme fane", () => {
    expect(getTabId()).toBe(getTabId());
    expect(sanitizeTabId(getTabId())).toBe(getTabId());
  });

  it("serveren afviser alt andet end et kort, harmløst id", () => {
    expect(sanitizeTabId(null)).toBeNull();
    expect(sanitizeTabId("")).toBeNull();
    expect(sanitizeTabId("a".repeat(65))).toBeNull();
    expect(sanitizeTabId('x"},{"type":"sync')).toBeNull();
  });
});
