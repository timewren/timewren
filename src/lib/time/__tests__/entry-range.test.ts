import { describe, expect, it } from "vitest";
import { rangeToISO } from "../entry-range";

describe("rangeToISO", () => {
  it("returnerer null uden både start og slut", () => {
    expect(rangeToISO("2026-10-02", "09:00", null)).toBeNull();
    expect(rangeToISO("2026-10-02", undefined, "10:00")).toBeNull();
  });

  it("bygger lokale tidsstempler på datoen", () => {
    const r = rangeToISO("2026-10-02", "09:15", "11:45");
    expect(r).not.toBeNull();
    const start = new Date(r?.startTime ?? "");
    const end = new Date(r?.endTime ?? "");
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(2);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(15);
    expect((end.getTime() - start.getTime()) / 60000).toBe(150);
  });

  it("slut før start = over midnat", () => {
    const r = rangeToISO("2026-10-02", "23:00", "01:00");
    const start = new Date(r?.startTime ?? "");
    const end = new Date(r?.endTime ?? "");
    expect(end.getDate()).toBe(3);
    expect((end.getTime() - start.getTime()) / 3600000).toBe(2);
  });
});
