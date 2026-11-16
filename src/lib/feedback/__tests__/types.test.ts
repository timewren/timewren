import { REPORT_TYPES } from "bugbottle";
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_TYPES,
  type FeedbackType,
  toFeedbackType,
  toReportType,
} from "../types";

describe("feedback-typer", () => {
  it("mapper TimeTrack-typer til bugbottles typer", () => {
    expect(toReportType("bug")).toBe("bug");
    expect(toReportType("feature")).toBe("idea");
    expect(toReportType("feedback")).toBe("other");
  });

  it("mapper bugbottles typer tilbage til TimeTracks", () => {
    expect(toFeedbackType("bug")).toBe("bug");
    expect(toFeedbackType("idea")).toBe("feature");
    expect(toFeedbackType("other")).toBe("feedback");
  });

  it("er en rundtur begge veje", () => {
    for (const type of FEEDBACK_TYPES) {
      expect(toFeedbackType(toReportType(type))).toBe(type);
    }
    for (const type of REPORT_TYPES) {
      expect(toReportType(toFeedbackType(type))).toBe(type);
    }
  });

  it("dækker alle af pakkens typer", () => {
    expect([...REPORT_TYPES].sort()).toEqual(
      [...FEEDBACK_TYPES].map((t: FeedbackType) => toReportType(t)).sort(),
    );
  });
});
