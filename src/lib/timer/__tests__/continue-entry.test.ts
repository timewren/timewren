import { describe, expect, it } from "vitest";
import { buildContinuedEntryPatch } from "../continue-entry";

const original = {
  // time_entries.date gemmes som UTC-midnat på den danske dato
  date: new Date("2026-10-01T00:00:00.000Z"),
  startTime: new Date("2026-10-01T06:02:00.000Z"),
  endTime: new Date("2026-10-01T07:02:00.000Z"),
  isBilled: false,
  invoiceId: null,
};

describe("buildContinuedEntryPatch (Fortsæt bevarer starttiden)", () => {
  it("lægger sessionen oven i postens timer og flytter kun sluttiden", () => {
    const patch = buildContinuedEntryPatch({
      original,
      continuingEntryHours: 1,
      sessionSeconds: 30 * 60,
      endTime: new Date("2026-10-01T11:30:00.000Z"),
    });
    expect(patch).toEqual({
      hours: 1.5,
      date: "2026-10-01",
      endTime: "2026-10-01T11:30:00.000Z",
    });
    // Starttiden sendes aldrig — den skal blive ved ankomsttidspunktet
    expect(patch).not.toHaveProperty("startTime");
  });

  it("beholder postens dato, også når der fortsættes en anden dag", () => {
    const patch = buildContinuedEntryPatch({
      original,
      continuingEntryHours: 1,
      sessionSeconds: 600,
      endTime: new Date("2026-10-02T09:00:00.000Z"),
    });
    expect(patch?.date).toBe("2026-10-01");
  });

  it("sender ingen sluttid for en post uden tidsinterval", () => {
    const patch = buildContinuedEntryPatch({
      original: { ...original, startTime: null, endTime: null },
      continuingEntryHours: 2,
      sessionSeconds: 3600,
      endTime: new Date("2026-10-01T11:30:00.000Z"),
    });
    expect(patch).toEqual({ hours: 3, date: "2026-10-01" });
  });

  it("afrunder til to decimaler og aldrig under 0,01", () => {
    expect(
      buildContinuedEntryPatch({
        original,
        continuingEntryHours: 0,
        sessionSeconds: 1,
        endTime: new Date("2026-10-01T11:30:00.000Z"),
      })?.hours,
    ).toBe(0.01);
    expect(
      buildContinuedEntryPatch({
        original,
        continuingEntryHours: 1.25,
        sessionSeconds: 20 * 60,
        endTime: new Date("2026-10-01T11:30:00.000Z"),
      })?.hours,
    ).toBe(1.58);
  });

  it("en faktureret post kan ikke fortsættes → null (gem som ny post)", () => {
    expect(
      buildContinuedEntryPatch({
        original: { ...original, isBilled: true },
        continuingEntryHours: 1,
        sessionSeconds: 600,
        endTime: new Date(),
      }),
    ).toBeNull();
    expect(
      buildContinuedEntryPatch({
        original: { ...original, invoiceId: "inv-1" },
        continuingEntryHours: 1,
        sessionSeconds: 600,
        endTime: new Date(),
      }),
    ).toBeNull();
  });
});
