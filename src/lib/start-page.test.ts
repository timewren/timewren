import { describe, expect, it } from "vitest";
import {
  DEFAULT_START_PAGE,
  isKnownStartPage,
  isStartPageVisible,
  START_PAGE_HREFS,
  START_PAGE_OPTIONS,
} from "./start-page";

const allOn = { isFlagEnabled: () => true, isModuleEnabled: () => true };
const allOff = { isFlagEnabled: () => false, isModuleEnabled: () => false };

describe("START_PAGE_OPTIONS", () => {
  it("indeholder den aftalte hvidliste med labels", () => {
    expect(START_PAGE_OPTIONS).toEqual([
      { href: "/dashboard", label: "Overblik" },
      { href: "/dashboard/time", label: "Tidsregistrering" },
      { href: "/dashboard/tasks", label: "Opgaver" },
      { href: "/dashboard/calendar", label: "Kalender" },
      { href: "/dashboard/clients", label: "Kunder" },
      { href: "/dashboard/projects", label: "Projekter" },
      { href: "/dashboard/klippekort", label: "Klippekort" },
      { href: "/dashboard/invoices", label: "Fakturaer" },
    ]);
  });
});

describe("isKnownStartPage", () => {
  it("accepterer kun hvidlistede stier", () => {
    for (const href of START_PAGE_HREFS) {
      expect(isKnownStartPage(href)).toBe(true);
    }
  });

  it("afviser ukendt, null og undefined", () => {
    expect(isKnownStartPage("/dashboard/overblik")).toBe(false);
    expect(isKnownStartPage("/dashboard/settings")).toBe(false);
    expect(isKnownStartPage(null)).toBe(false);
    expect(isKnownStartPage(undefined)).toBe(false);
    expect(isKnownStartPage("")).toBe(false);
  });
});

describe("isStartPageVisible", () => {
  it("/dashboard er altid synlig, uanset moduler/flag/rolle", () => {
    expect(isStartPageVisible(DEFAULT_START_PAGE, allOff)).toBe(true);
  });

  it("afviser en ukendt sti", () => {
    expect(isStartPageVisible("/dashboard/settings", allOn)).toBe(false);
  });

  it("skjuler Klippekort når modulet eller feature-flagget er slukket", () => {
    expect(isStartPageVisible("/dashboard/klippekort", allOff)).toBe(false);
    expect(
      isStartPageVisible("/dashboard/klippekort", {
        isFlagEnabled: () => true,
        isModuleEnabled: () => false,
      }),
    ).toBe(false);
    expect(isStartPageVisible("/dashboard/klippekort", allOn)).toBe(true);
  });

  it("skjuler en side rollen kun har 'none'-adgang til", () => {
    expect(
      isStartPageVisible("/dashboard/time", {
        ...allOn,
        canAccessModule: () => false,
      }),
    ).toBe(false);
    expect(
      isStartPageVisible("/dashboard/time", {
        ...allOn,
        canAccessModule: () => true,
      }),
    ).toBe(true);
  });

  it("skjuler freelancerOnly-sider for enterprise-medlemmer", () => {
    expect(
      isStartPageVisible("/dashboard/time", {
        ...allOn,
        orgProfile: "enterprise",
        role: "member",
      }),
    ).toBe(false);
    expect(
      isStartPageVisible("/dashboard/time", {
        ...allOn,
        orgProfile: "enterprise",
        role: "owner",
      }),
    ).toBe(true);
  });
});
