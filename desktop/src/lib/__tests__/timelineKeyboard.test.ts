import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { activeActivityAnnouncement, activityLabel } from "../timelineKeyboard";
import type { Activity } from "../types";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    app_name: "Code",
    window_title: "timetrack-desktop",
    url: null,
    git_branch: null,
    git_repo: null,
    context_path: null,
    file_path: null,
    category: null,
    project_id: null,
    client_id: null,
    confidence: null,
    classification_source: null,
    classification_reason: null,
    is_confirmed: false,
    is_idle: false,
    started_at: "2026-09-29T09:00:00",
    ended_at: "2026-09-29T09:32:00",
    duration: 1920,
    ...overrides,
  };
}

describe("activityLabel", () => {
  it("viser app og vinduestitel", () => {
    expect(activityLabel(makeActivity())).toBe("Code, timetrack-desktop");
  });

  it("springer titlen over, den bare gentager appen", () => {
    expect(activityLabel(makeActivity({ window_title: "Code" }))).toBe("Code");
  });

  it("klarer en tom titel", () => {
    expect(activityLabel(makeActivity({ window_title: "   " }))).toBe("Code");
    expect(activityLabel(makeActivity({ window_title: null }))).toBe("Code");
  });

  it("korter en meget lang titel, så den ikke drukker skærmlæseren", () => {
    const label = activityLabel(
      makeActivity({ window_title: "x".repeat(200) }),
    );
    expect(label.length).toBeLessThan("Code, ".length + 61);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("activeActivityAnnouncement", () => {
  const t = i18n.t.bind(i18n);

  it("nævner både hvor man er og hvor mange der er", () => {
    const text = activeActivityAnnouncement(makeActivity(), 3, 12, t);
    expect(text).toContain("3");
    expect(text).toContain("12");
    expect(text).toContain("Code, timetrack-desktop");
  });

  it("læser klokkeslættet fra tidspunktet, ikke fra varigheden", () => {
    const text = activeActivityAnnouncement(makeActivity(), 1, 1, t);
    expect(text).toContain("09:00");
    expect(text).toContain("09:32");
  });

  it("skifter sprog med den aktive locale", () => {
    const text = activeActivityAnnouncement(
      makeActivity({ app_name: "Kode", window_title: null }),
      1,
      2,
      i18n.getFixedT("en"),
    );
    expect(text).toContain("Activity 1 of 2");
  });
});
