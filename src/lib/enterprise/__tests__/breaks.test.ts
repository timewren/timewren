import { describe, expect, it } from "vitest";
import {
  presenceByUserDay,
  sessionHours,
  unpaidBreakHoursByUser,
} from "../breaks";

const at = (day: string, time: string) => new Date(`${day}T${time}:00`);

describe("sessionHours", () => {
  it("regner timer mellem ind og ud; åben session er 0", () => {
    expect(
      sessionHours({
        userId: "a",
        checkedInAt: at("2026-08-24", "08:00"),
        checkedOutAt: at("2026-08-24", "16:00"),
      }),
    ).toBe(8);
    expect(
      sessionHours({
        userId: "a",
        checkedInAt: at("2026-08-24", "08:00"),
        checkedOutAt: null,
      }),
    ).toBe(0);
  });
});

describe("presenceByUserDay", () => {
  it("lægger flere sessioner samme dag sammen pr. bruger", () => {
    const map = presenceByUserDay([
      {
        userId: "a",
        checkedInAt: at("2026-08-24", "08:00"),
        checkedOutAt: at("2026-08-24", "11:00"),
      },
      {
        userId: "a",
        checkedInAt: at("2026-08-24", "12:00"),
        checkedOutAt: at("2026-08-24", "16:30"),
      },
      {
        userId: "b",
        checkedInAt: at("2026-08-24", "09:00"),
        checkedOutAt: at("2026-08-24", "14:00"),
      },
    ]);
    expect(map.get("a|2026-08-24")).toBe(7.5);
    expect(map.get("b|2026-08-24")).toBe(5);
  });
});

describe("unpaidBreakHoursByUser (lønrapportens 'Pause fratrukket')", () => {
  const sessions = [
    // a: 8 t mandag → 0,5 fratrukket; 5 t tirsdag → intet
    {
      userId: "a",
      checkedInAt: at("2026-08-24", "08:00"),
      checkedOutAt: at("2026-08-24", "16:00"),
    },
    {
      userId: "a",
      checkedInAt: at("2026-08-25", "08:00"),
      checkedOutAt: at("2026-08-25", "13:00"),
    },
    // b: to sessioner samme dag = 7,5 t → ét fradrag på 45 min (override)
    {
      userId: "b",
      checkedInAt: at("2026-08-24", "08:00"),
      checkedOutAt: at("2026-08-24", "11:00"),
    },
    {
      userId: "b",
      checkedInAt: at("2026-08-24", "12:00"),
      checkedOutAt: at("2026-08-24", "16:30"),
    },
    // c: præcis 6 t → intet fradrag, optræder ikke
    {
      userId: "c",
      checkedInAt: at("2026-08-24", "08:00"),
      checkedOutAt: at("2026-08-24", "14:00"),
    },
  ];

  it("summerer fradraget pr. bruger over perioden", () => {
    const result = unpaidBreakHoursByUser(sessions, (userId) =>
      userId === "b" ? 45 : 30,
    );
    expect(result.get("a")).toBe(0.5);
    expect(result.get("b")).toBe(0.75);
    expect(result.has("c")).toBe(false);
  });

  it("giver tom kolonne når pausen er 0 minutter", () => {
    expect(unpaidBreakHoursByUser(sessions, () => 0).size).toBe(0);
  });
});
