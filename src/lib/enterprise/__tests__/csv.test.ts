import { describe, expect, it } from "vitest";
import { buildCsv, csvEscape, csvNumber } from "../csv";

describe("csvEscape", () => {
  it("lader simple værdier være", () => {
    expect(csvEscape("Anne Pedersen")).toBe("Anne Pedersen");
  });

  it("quoter semikolon, citationstegn og linjeskift", () => {
    expect(csvEscape("Møde; opfølgning")).toBe('"Møde; opfølgning"');
    expect(csvEscape('Han sagde "hej"')).toBe('"Han sagde ""hej"""');
    expect(csvEscape("linje1\nlinje2")).toBe('"linje1\nlinje2"');
  });
});

describe("csvNumber", () => {
  it("bruger dansk decimalkomma med to decimaler", () => {
    expect(csvNumber(7.4)).toBe("7,40");
    expect(csvNumber(0)).toBe("0,00");
    expect(csvNumber(-14.8)).toBe("-14,80");
  });
});

describe("buildCsv", () => {
  it("bygger semikolon-CSV med BOM og CRLF", () => {
    const csv = buildCsv(
      ["Navn", "Timer"],
      [
        ["Anne", 7.4],
        ["Bo; konsulent", 3],
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe("Navn;Timer");
    expect(lines[1]).toBe("Anne;7,40");
    expect(lines[2]).toBe('"Bo; konsulent";3,00');
    expect(lines[3]).toBe("");
  });
});
