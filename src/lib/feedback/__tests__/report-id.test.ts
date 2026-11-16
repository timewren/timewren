import { describe, expect, it } from "vitest";
import { reportIdPrefix, shortReportId } from "../report-id";

describe("rapportnummer", () => {
  it("er de første 8 tegn af uuid'et, som panelet og admin-listen viser", () => {
    expect(shortReportId("731cf28b-5b0e-4c3a-9f1d-2a6b7c8d9e0f")).toBe(
      "731cf28b",
    );
  });

  it("søges på som et præfiks, uanset store bogstaver, mellemrum og #", () => {
    expect(reportIdPrefix("731cf28b")).toBe("731cf28b");
    expect(reportIdPrefix("  #731CF28B ")).toBe("731cf28b");
    expect(reportIdPrefix("731cf28b-5b0e-4c3a-9f1d-2a6b7c8d9e0f")).toBe(
      "731cf28b-5b0e-4c3a-9f1d-2a6b7c8d9e0f",
    );
  });

  it("afviser alt, der ikke kan være en del af et uuid", () => {
    expect(reportIdPrefix("")).toBeNull();
    expect(reportIdPrefix("   ")).toBeNull();
    expect(reportIdPrefix("731cf28%")).toBeNull();
    expect(reportIdPrefix("abc_def")).toBeNull();
    expect(reportIdPrefix("g".repeat(8))).toBeNull();
    expect(reportIdPrefix("a".repeat(37))).toBeNull();
  });
});
