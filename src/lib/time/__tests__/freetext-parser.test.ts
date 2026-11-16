import { describe, expect, it } from "vitest";
import {
  type FreetextContext,
  levenshtein,
  normalizeName,
  parseFreetextEntry,
} from "../freetext-parser";

// Torsdag 1. oktober 2026
const TODAY = "2026-10-01";

const ctx: FreetextContext = {
  today: TODAY,
  clients: [
    { id: "c-karen", name: "Karen Jensen", company: null },
    { id: "c-hansen", name: "Hansen Byg ApS", company: "Hansen Byg ApS" },
    { id: "c-x", name: "X", company: null },
    { id: "c-soeren", name: "Søren Ødegaard", company: "Ødegaard Rådgivning" },
    { id: "c-intern", name: "Mahope intern", company: null },
    { id: "c-lars1", name: "Lars Nielsen", company: null },
    { id: "c-lars2", name: "Lars Petersen", company: null },
  ],
  projects: [
    { id: "p-web", name: "Ny hjemmeside", clientId: "c-hansen" },
    { id: "p-seo", name: "SEO-optimering", clientId: "c-hansen" },
    { id: "p-bog", name: "Bogføring", clientId: "c-soeren" },
    { id: "p-shop", name: "Webshop", clientId: "c-karen" },
  ],
};

const parse = (text: string) => parseFreetextEntry(text, ctx);

describe("parseFreetextEntry — eksemplerne fra #681", () => {
  it("log et telefonopkald til Karen på 10 minutter", () => {
    const r = parse("log et telefonopkald til Karen på 10 minutter");
    expect(r.hours).toBeCloseTo(10 / 60, 2);
    expect(r.clientId).toBe("c-karen");
    expect(r.date).toBe(TODAY);
    expect(r.dateFromText).toBe(false);
    expect(r.description).toBe("Telefonopkald");
    expect(r.missing).toEqual([]);
  });

  it("2 timer på forberedelse til X i dag", () => {
    const r = parse("2 timer på forberedelse til X i dag");
    expect(r.hours).toBe(2);
    expect(r.clientId).toBe("c-x");
    expect(r.date).toBe(TODAY);
    expect(r.dateFromText).toBe(true);
    expect(r.description).toBe("Forberedelse");
  });
});

describe("varighed", () => {
  it.each([
    ["2 timer møde", 2],
    ["1 time møde", 1],
    ["1,5 t møde", 1.5],
    ["1.5 timer møde", 1.5],
    ["45 min møde", 0.75],
    ["90 minutter møde", 1.5],
    ["30 m møde", 0.5],
    ["2h møde", 2],
    ["1t30 møde", 1.5],
    ["1:30 timer møde", 1.5],
    ["2 timer og 30 min møde", 2.5],
    ["1 time og 15 minutter møde", 1.25],
    ["halv time møde", 0.5],
    ["en halv time møde", 0.5],
    ["halvanden time møde", 1.5],
    ["to og en halv time møde", 2.5],
    ["2 og en halv time møde", 2.5],
    ["en time møde", 1],
    ["to timer møde", 2],
    ["kvarter møde", 0.25],
    ["et kvarter møde", 0.25],
    ["tre kvarter møde", 0.75],
    ["ti minutter møde", 0.17],
    ["femogfyrre minutter møde", 0.75],
    ["møde i 3 timer", 3],
    ["møde ca. 2 timer", 2],
  ])("%s → %s t", (text, hours) => {
    const r = parse(text);
    expect(r.hours).toBeCloseTo(hours, 2);
    expect(r.description).toBe("Møde");
  });

  it("mangler varighed → missing indeholder hours", () => {
    const r = parse("møde med Karen");
    expect(r.hours).toBeNull();
    expect(r.missing).toContain("hours");
  });

  it("forveksler ikke ord der starter som en enhed", () => {
    // "2 tænkepauser" må ikke blive til 2 timer
    expect(parse("2 tænkepauser").hours).toBeNull();
    expect(parse("et møde").hours).toBeNull();
  });
});

describe("tidsrum", () => {
  it("kl. 9-11", () => {
    const r = parse("kl. 9-11 workshop for Hansen Byg");
    expect(r.startTime).toBe("09:00");
    expect(r.endTime).toBe("11:00");
    expect(r.hours).toBe(2);
    expect(r.description).toBe("Workshop");
  });

  it("fra 9 til 11.30", () => {
    const r = parse("fra 9 til 11.30 kodning");
    expect(r.startTime).toBe("09:00");
    expect(r.endTime).toBe("11:30");
    expect(r.hours).toBe(2.5);
  });

  it("kl 13 til 14", () => {
    const r = parse("kl 13 til 14 support");
    expect(r.hours).toBe(1);
    expect(r.description).toBe("Support");
  });

  it("9:15-10 uden kl.", () => {
    const r = parse("9:15-10 opfølgning");
    expect(r.startTime).toBe("09:15");
    expect(r.hours).toBe(0.75);
  });

  it("over midnat", () => {
    const r = parse("kl. 23-1 driftsvagt");
    expect(r.hours).toBe(2);
  });

  it("'2-3 timer' er ikke et tidsrum", () => {
    const r = parse("2-3 timer analyse");
    expect(r.startTime).toBeNull();
  });
});

describe("dato", () => {
  it.each([
    ["i dag", "2026-10-01"],
    ["idag", "2026-10-01"],
    ["i går", "2026-09-30"],
    ["igår", "2026-09-30"],
    ["i forgårs", "2026-09-29"],
    // Torsdag i dag → mandag = 28/9
    ["mandag", "2026-09-28"],
    ["i mandags", "2026-09-28"],
    ["sidste mandag", "2026-09-28"],
    // Ugedag = i dag → i dag; "i torsdags" → for en uge siden
    ["torsdag", "2026-10-01"],
    ["i torsdags", "2026-09-24"],
    ["fredag", "2026-09-25"],
    ["d. 3/10", "2026-10-03"],
    ["28/9", "2026-09-28"],
    ["den 28/9", "2026-09-28"],
    ["d. 28.9", "2026-09-28"],
    ["3. oktober", "2026-10-03"],
    ["d. 15 sep", "2026-09-15"],
    ["28/9-2025", "2025-09-28"],
  ])("%s → %s", (phrase, iso) => {
    const r = parse(`1 time møde ${phrase}`);
    expect(r.date).toBe(iso);
    expect(r.dateFromText).toBe(true);
    expect(r.description).toBe("Møde");
  });

  it("dato langt ude i fremtiden uden årstal er sidste år", () => {
    // 20/12 set fra 1/10 → 20/12-2025
    expect(parse("1 time møde 20/12").date).toBe("2025-12-20");
  });

  it("ugyldig dato ignoreres", () => {
    const r = parse("1 time møde 31/2");
    expect(r.date).toBe(TODAY);
    expect(r.dateFromText).toBe(false);
  });

  it("årsskifte: i går fra 1. januar", () => {
    const r = parseFreetextEntry("1 time i går", {
      ...ctx,
      today: "2027-01-01",
    });
    expect(r.date).toBe("2026-12-31");
  });
});

describe("klient og projekt", () => {
  it("matcher fornavn", () => {
    expect(parse("1 time til Karen").clientId).toBe("c-karen");
  });

  it("tåler stavefejl", () => {
    expect(parse("1 time til Kraen").clientId).toBe("c-karen");
    expect(parse("1 time for Hansne Byg").clientId).toBe("c-hansen");
  });

  it("ignorerer ApS/A/S og tåler æøå skrevet som ae/oe/aa", () => {
    expect(parse("2 timer for Hansen Byg").clientId).toBe("c-hansen");
    expect(parse("2 timer for Oedegaard Raadgivning").clientId).toBe(
      "c-soeren",
    );
  });

  it("matcher projekt og udleder klienten", () => {
    const r = parse("3 timer på ny hjemmeside");
    expect(r.projectId).toBe("p-web");
    expect(r.clientId).toBe("c-hansen");
    expect(r.missing).toEqual([]);
  });

  it("projekt med stavefejl", () => {
    expect(parse("1 time bogfoering").projectId).toBe("p-bog");
    expect(parse("1 time bogføirng").projectId).toBe("p-bog");
  });

  it("klient + projekt: projektet søges kun blandt klientens projekter", () => {
    const r = parse("1 time webshop for Karen");
    expect(r.clientId).toBe("c-karen");
    expect(r.projectId).toBe("p-shop");
  });

  it("tvetydigt fornavn giver kandidater i stedet for et gæt", () => {
    const r = parse("1 time opkald til Lars");
    expect(r.clientId).toBeNull();
    expect(r.clientCandidates.map((c) => c.id).sort()).toEqual([
      "c-lars1",
      "c-lars2",
    ]);
    expect(r.missing).toContain("client");
  });

  it("efternavn afgør tvetydigheden", () => {
    expect(parse("1 time opkald til Lars Petersen").clientId).toBe("c-lars2");
  });

  it("intet match → tomt og missing client", () => {
    const r = parse("1 time oprydning");
    expect(r.clientId).toBeNull();
    expect(r.projectId).toBeNull();
    expect(r.missing).toEqual(["client"]);
    expect(r.description).toBe("Oprydning");
  });

  it("småord matcher aldrig en klient", () => {
    const r = parseFreetextEntry("1 time til i og for", {
      ...ctx,
      clients: [{ id: "c-i", name: "I", company: null }],
    });
    expect(r.clientId).toBeNull();
  });
});

describe("fakturerbar", () => {
  it.each([
    ["ikke fakturerbar", false],
    ["ikke-fakturerbart", false],
    ["ufakturerbar", false],
    ["intern", false],
    ["intern tid", false],
    ["internt", false],
    ["fakturerbar", true],
  ])("%s → %s", (phrase, expected) => {
    const r = parse(`1 time møde ${phrase}`);
    expect(r.isBillable).toBe(expected);
    expect(r.description).toBe("Møde");
  });

  it("ikke nævnt → null (standard gælder)", () => {
    expect(parse("1 time møde").isBillable).toBeNull();
  });
});

describe("beskrivelse", () => {
  it("bevarer originalens store bogstaver og resten af teksten", () => {
    const r = parse("I går 2 timer på SEO-analyse og rapport til Hansen Byg");
    expect(r.date).toBe("2026-09-30");
    expect(r.hours).toBe(2);
    expect(r.clientId).toBe("c-hansen");
    expect(r.description).toBe("SEO-analyse og rapport");
  });

  it("fjerner indledende 'jeg har brugt'", () => {
    const r = parse("jeg har brugt 45 min på mails til Karen");
    expect(r.hours).toBe(0.75);
    expect(r.description).toBe("Mails");
  });

  it("tom tekst giver tomt forslag uden at kaste", () => {
    const r = parse("");
    expect(r.hours).toBeNull();
    expect(r.description).toBe("");
    expect(r.missing).toEqual(["hours", "client"]);
  });

  it("alt i én sætning", () => {
    const r = parse(
      "møde med Søren om bogføring i mandags kl. 10-11.30, ikke fakturerbar",
    );
    expect(r.clientId).toBe("c-soeren");
    expect(r.projectId).toBe("p-bog");
    expect(r.date).toBe("2026-09-28");
    expect(r.startTime).toBe("10:00");
    expect(r.endTime).toBe("11:30");
    expect(r.hours).toBe(1.5);
    expect(r.isBillable).toBe(false);
    expect(r.description).toBe("Møde");
  });
});

describe("hjælpere", () => {
  it("normalizeName", () => {
    expect(normalizeName("Hansen Byg ApS")).toBe("hansen byg");
    expect(normalizeName("Ødegaard Rådgivning A/S")).toBe(
      "oedegaard raadgivning",
    );
    expect(normalizeName("Café Ægir")).toBe("cafe aegir");
  });

  it("levenshtein", () => {
    expect(levenshtein("karen", "kraen")).toBe(1);
    expect(levenshtein("karen", "karin")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("review-fund (#681)", () => {
  it("brøk-varigheder tolkes ikke som datoer", () => {
    for (const [text, hours] of [
      ["1/2 time møde", 0.5],
      ["3/4 time møde", 0.75],
      ["1/4 t møde", 0.25],
    ] as const) {
      const r = parse(text);
      expect(r.hours).toBeCloseTo(hours, 2);
      expect(r.dateFromText).toBe(false);
      expect(r.date).toBe(TODAY);
    }
  });

  it("'faktureres ikke' er ikke fakturerbar", () => {
    expect(parse("1 time møde faktureres ikke").isBillable).toBe(false);
    expect(parse("1 time møde fakturerbart ikke").isBillable).toBe(false);
  });

  it("fuldt navn vinder over et navn der er et præfiks", () => {
    const localCtx: FreetextContext = {
      today: TODAY,
      clients: [
        { id: "c-jensen", name: "Jensen", company: null },
        { id: "c-jensenbyg", name: "Jensen Byg", company: null },
      ],
      projects: [],
    };
    const r = parseFreetextEntry("2 timer for Jensen Byg", localCtx);
    expect(r.clientId).toBe("c-jensenbyg");
    expect(r.missing).toEqual([]);
  });

  it("almindelige småt-skrevne ord rammer ikke et navne-fragment", () => {
    const localCtx: FreetextContext = {
      today: TODAY,
      clients: [{ id: "c-nordic", name: "Nordic Design ApS", company: null }],
      projects: [],
    };
    // "design" er ikke skrevet med stort og står ikke efter en præposition
    const r = parseFreetextEntry("2 timer lavet design til forside", localCtx);
    expect(r.clientId).toBeNull();
    expect(r.description.toLowerCase()).toContain("design");
  });

  it("navn med stort rammer stadig et fragment", () => {
    const localCtx: FreetextContext = {
      today: TODAY,
      clients: [{ id: "c-nordic", name: "Nordic Design ApS", company: null }],
      projects: [],
    };
    const r = parseFreetextEntry("2 timer møde med Nordic", localCtx);
    expect(r.clientId).toBe("c-nordic");
  });
});
