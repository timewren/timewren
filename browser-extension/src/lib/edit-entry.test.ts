import { describe, expect, it } from "vitest";
import {
  parseHoursInput,
  resolveCreateTimes,
  resolveEditTimes,
} from "./edit-entry";

const at = (h: number, m = 0, day = 26) =>
  new Date(2026, 9, day, h, m).toISOString();

const base = {
  date: "2026-10-26",
  originalStart: at(9),
  originalEnd: at(11),
  originalHours: 2,
  start: "09:00",
  end: "11:00",
  hoursInput: "2",
};

describe("resolveEditTimes", () => {
  it("uændrede tider sendes ikke, og timetallet står", () => {
    expect(resolveEditTimes(base)).toEqual({ ok: true, hours: 2 });
  });

  it("uændret post over midnat afvises ikke", () => {
    expect(
      resolveEditTimes({
        ...base,
        originalStart: at(23),
        originalEnd: at(1, 0, 27),
        start: "23:00",
        end: "01:00",
      }),
    ).toEqual({ ok: true, hours: 2 });
  });

  it("ændrede tider sendes med nyt timetal", () => {
    const result = resolveEditTimes({ ...base, end: "12:30" });
    expect(result).toMatchObject({ ok: true, hours: 3.5 });
    if (!result.ok) throw new Error("forventede ok");
    expect(new Date(result.endTime ?? "").getHours()).toBe(12);
    expect(new Date(result.startTime ?? "").getHours()).toBe(9);
  });

  it("ændret post med slut 00:00 slutter ved midnat, som ved oprettelse", () => {
    const result = resolveEditTimes({ ...base, start: "22:30", end: "00:00" });
    expect(result).toMatchObject({ ok: true, hours: 1.5 });
    if (!result.ok) throw new Error("forventede ok");
    const end = new Date(result.endTime ?? "");
    const start = new Date(result.startTime ?? "");
    expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
  });

  it("slut før start giver en fejltekst", () => {
    expect(resolveEditTimes({ ...base, start: "12:00" })).toEqual({
      ok: false,
      error: "Sluttid skal være efter starttid",
    });
  });

  it("kun den ene tid udfyldt giver en fejltekst", () => {
    expect(resolveEditTimes({ ...base, end: "" })).toEqual({
      ok: false,
      error: "Udfyld både start og slut",
    });
  });

  it("ryddede tider på en post med tidspunkter afvises", () => {
    // Serveren kan ikke fjerne tiderne: 09-11 rettet til 5 t ville blive en
    // 2-timers blok med 5 t
    expect(
      resolveEditTimes({ ...base, start: "", end: "", hoursInput: "5" }),
    ).toEqual({
      ok: false,
      error: "Tiderne kan ikke fjernes. Ret start og slut i stedet",
    });
  });

  it("post uden tidspunkt: timetallet kan rettes", () => {
    expect(
      resolveEditTimes({
        ...base,
        originalStart: null,
        originalEnd: null,
        start: "",
        end: "",
        hoursInput: "1,25",
      }),
    ).toEqual({ ok: true, hours: 1.25 });
  });

  it("post uden tidspunkt kan få tider", () => {
    expect(
      resolveEditTimes({
        ...base,
        originalStart: null,
        originalEnd: null,
        start: "13:00",
        end: "14:00",
      }),
    ).toMatchObject({ ok: true, hours: 1 });
  });
});

describe("parseHoursInput", () => {
  it("læser dansk komma og afviser 0 og tekst", () => {
    expect(parseHoursInput("7,5")).toBe(7.5);
    expect(parseHoursInput("0")).toBeNull();
    expect(parseHoursInput("abc")).toBeNull();
  });
});

describe("resolveCreateTimes", () => {
  it("giver minutter efter midnat for et gyldigt tidsrum", () => {
    expect(resolveCreateTimes("09:15", "10:45")).toEqual({
      ok: true,
      startMinutes: 9 * 60 + 15,
      endMinutes: 10 * 60 + 45,
    });
  });

  it("slut 00:00 efter en start betyder midnat (døgnets slutning)", () => {
    expect(resolveCreateTimes("23:00", "00:00")).toEqual({
      ok: true,
      startMinutes: 23 * 60,
      endMinutes: 24 * 60,
    });
  });

  it("afviser slut før start og tomme felter med dansk tekst", () => {
    expect(resolveCreateTimes("10:00", "09:00")).toEqual({
      ok: false,
      error: "Sluttid skal være efter starttid",
    });
    expect(resolveCreateTimes("10:00", "10:00")).toEqual({
      ok: false,
      error: "Sluttid skal være efter starttid",
    });
    expect(resolveCreateTimes("", "10:00")).toEqual({
      ok: false,
      error: "Udfyld både start og slut",
    });
  });
});
