import { describe, expect, it } from "vitest";
import {
  entryDateFromInput,
  entryDateStrFromInput,
  entryDateStrInput,
  hoursKey,
} from "../entry-date-input";

// Køres i CI både med TZ=UTC og TZ=Europe/Copenhagen; resultatet må ikke
// afhænge af processens tidszone.
describe("entryDateStrFromInput", () => {
  it("tager en ren kalenderdato bogstaveligt", () => {
    expect(entryDateStrFromInput("2026-07-16")).toBe("2026-07-16");
    expect(entryDateStrFromInput(" 2026-07-16 ")).toBe("2026-07-16");
  });

  it("lægger et tidspunkt med zone på den danske dag", () => {
    // 22:30Z = 00:30 dansk sommertid den 17.
    expect(entryDateStrFromInput("2026-07-16T22:30:00Z")).toBe("2026-07-17");
    expect(entryDateStrFromInput("2026-07-16T21:30:00.000Z")).toBe(
      "2026-07-16",
    );
    // Vintertid: 23:30Z = 00:30 den 16.
    expect(entryDateStrFromInput("2026-01-15T23:30:00Z")).toBe("2026-01-16");
    expect(entryDateStrFromInput("2026-07-17T00:30:00+02:00")).toBe(
      "2026-07-17",
    );
  });

  it("læser vægur uden zone som dansk tid", () => {
    expect(entryDateStrFromInput("2026-07-16T23:30:00")).toBe("2026-07-16");
    expect(entryDateStrFromInput("2026-07-16T00:30")).toBe("2026-07-16");
  });

  it("afviser dage der ikke findes og løst input", () => {
    expect(entryDateStrFromInput("2026-02-31")).toBeNull();
    expect(entryDateStrFromInput("2026-02-31T10:00:00")).toBeNull();
    expect(entryDateStrFromInput("16/07/2026")).toBeNull();
    expect(entryDateStrFromInput("July 16, 2026 Z")).toBeNull();
    expect(entryDateStrFromInput("")).toBeNull();
    expect(entryDateStrFromInput(42)).toBeNull();
    expect(entryDateStrFromInput(new Date("ugyldig"))).toBeNull();
  });

  it("giver lagringsværdien UTC-midnat", () => {
    expect(entryDateFromInput("2026-07-16T22:30:00Z")?.toISOString()).toBe(
      "2026-07-17T00:00:00.000Z",
    );
    expect(
      entryDateFromInput(new Date("2026-07-15T22:00:00Z"))?.toISOString(),
    ).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("entryDateStrInput (zod)", () => {
  it("normaliserer og afviser med dansk besked", () => {
    expect(entryDateStrInput.parse("2026-07-16T22:30:00Z")).toBe("2026-07-17");
    const bad = entryDateStrInput.safeParse("2026-13-01");
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/Ugyldig dato/);
  });
});

describe("hoursKey", () => {
  it("giver samme nøgle for Postgres-tekst og zod-tal", () => {
    expect(hoursKey("7.50")).toBe(hoursKey(7.5));
    expect(hoursKey("2.00")).toBe(hoursKey(2));
    expect(hoursKey("0.50")).toBe(hoursKey(0.5));
    expect(hoursKey("7.50")).not.toBe(hoursKey(7.75));
  });
});
