import { describe, expect, it } from "vitest";
import {
  decodePunycodeLabel,
  findPotentialMatches,
  getBestMatch,
  normalizeText,
} from "./smartMatching";

const BAGERIET = {
  id: "c-bageriet",
  name: "Bageriet på hjørnet",
};
const clients = [BAGERIET, { id: "c-acme", name: "Acme" }];
const projects = [
  { id: "p-web", name: "Ny hjemmeside", clientId: "c-bageriet" },
  { id: "p-kampagne", name: "Juleæbleskiver", clientId: "c-bageriet" },
];

function bestClientFor(domain: string, title = "", url = `https://${domain}/`) {
  const matches = findPotentialMatches(domain, url, title, clients, projects);
  return matches.find((m) => m.type === "client") ?? null;
}

describe("normalizeText", () => {
  it("bevarer æøå", () => {
    expect(normalizeText("Bageriet på Hjørnet!")).toBe("bageriet på hjørnet");
  });
});

describe("decodePunycodeLabel", () => {
  it("afkoder domæner med æøå", () => {
    expect(decodePunycodeLabel("xn--hjrnet-cya")).toBe("hjørnet");
    expect(decodePunycodeLabel("xn--bagerietphjrnet-plb93a")).toBe(
      "bagerietpåhjørnet",
    );
    expect(decodePunycodeLabel("xn--blegrden-d0af")).toBe("æblegården");
  });

  it("almindelige labels er uændrede", () => {
    expect(decodePunycodeLabel("bageriet")).toBe("bageriet");
  });
});

describe("findPotentialMatches med æøå", () => {
  it.each([
    ["bagerietpaahjoernet.dk"],
    ["bagerietpahjornet.dk"],
    ["bageriet-paa-hjoernet.dk"],
    ["www.xn--bagerietphjrnet-plb93a.dk"],
  ])("domænet %s matcher kunden", (domain) => {
    const match = bestClientFor(domain);
    expect(match?.id).toBe(BAGERIET.id);
    expect(match?.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("sidens titel med æøå matcher kunden", () => {
    const matches = findPotentialMatches(
      "example.com",
      "https://example.com/",
      "Bageriet på hjørnet - forside",
      clients,
      [],
    );
    expect(matches[0]?.id).toBe(BAGERIET.id);
  });

  it("URL med ae/oe/aa matcher et projekt med æøå", () => {
    const matches = findPotentialMatches(
      "drive.google.com",
      "https://drive.google.com/folder/juleaebleskiver-2026",
      "",
      clients,
      projects,
    );
    expect(matches.some((m) => m.id === "p-kampagne")).toBe(true);
  });

  it("et fremmed domæne matcher ikke", () => {
    expect(bestClientFor("nyheder.dk")).toBeNull();
  });

  it("begrundelserne er på dansk", () => {
    const matches = findPotentialMatches(
      "bagerietpaahjoernet.dk",
      "https://bagerietpaahjoernet.dk/",
      "",
      clients,
      projects,
    );
    const best = getBestMatch(matches);
    expect(best?.matchReason).toBe('Domænet indeholder "Bageriet på hjørnet"');
    expect(matches.find((m) => m.type === "project")?.matchReason).toBe(
      "Projekt hos Bageriet på hjørnet",
    );
  });
});
