import { describe, expect, it } from "vitest";
import { activeDialogIndex, trapTabTarget } from "./focus-trap";

describe("trapTabTarget", () => {
  it("Tab på sidste element går til det første", () => {
    expect(trapTabTarget(3, 2, false)).toBe(0);
  });

  it("Shift+Tab på første element går til det sidste", () => {
    expect(trapTabTarget(3, 0, true)).toBe(2);
  });

  it("midt i listen styrer browseren selv", () => {
    expect(trapTabTarget(3, 1, false)).toBeNull();
    expect(trapTabTarget(3, 1, true)).toBeNull();
    expect(trapTabTarget(3, 0, false)).toBeNull();
    expect(trapTabTarget(3, 2, true)).toBeNull();
  });

  it("fokus uden for dialogen trækkes ind", () => {
    expect(trapTabTarget(3, -1, false)).toBe(0);
    expect(trapTabTarget(3, -1, true)).toBe(2);
  });

  it("ingen fokuserbare elementer: hold fokus på dialogen", () => {
    expect(trapTabTarget(0, -1, false)).toBe(-1);
  });
});

describe("activeDialogIndex", () => {
  it("den øverste modale dialog gælder, når fokus ikke står i en inline boks", () => {
    expect(
      activeDialogIndex([
        { modal: true, hasFocus: false },
        { modal: false, hasFocus: false },
      ]),
    ).toBe(0);
  });

  it("en inline boks gælder, når fokus står i den", () => {
    expect(
      activeDialogIndex([
        { modal: true, hasFocus: true },
        { modal: false, hasFocus: true },
      ]),
    ).toBe(1);
  });

  it("ingen dialog gælder, når kun en inline boks er åben uden fokus", () => {
    expect(activeDialogIndex([{ modal: false, hasFocus: false }])).toBe(-1);
  });

  it("en modal oven på en anden vinder", () => {
    expect(
      activeDialogIndex([
        { modal: true, hasFocus: false },
        { modal: true, hasFocus: true },
      ]),
    ).toBe(1);
  });
});
