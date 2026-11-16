import { describe, expect, it } from "vitest";
import { timeEntries } from "@/lib/db/schema";
import {
  coerceTimestampFields,
  deriveHoursForTimeEntryUpdate,
  normalizeTimeEntryTiming,
  normalizeTimeEntryUpdateDate,
  pickPrimaryMembership,
  resolveSyncRemoteId,
  sanitizeKlippekortInsert,
  sanitizeKlippekortUpdate,
  sanitizeTimeEntryPush,
  scopeClientEntryId,
} from "./desktop-sync";

const PKG = "11111111-1111-1111-1111-111111111111";

describe("desktop-tidsstempler uden zone (#760)", () => {
  it.each([
    ["2026-07-16T23:30:00.123", "2026-07-16T21:30:00.123Z"],
    ["2026-01-16T23:30", "2026-01-16T22:30:00.000Z"],
    ["2026-07-16T23:30:00+02:00", "2026-07-16T21:30:00.000Z"],
    ["2026-01-16T23:30:00Z", "2026-01-16T23:30:00.000Z"],
  ])("fortolker %s eksplicit", (input, expected) => {
    const result = coerceTimestampFields(
      { startTime: input, endTime: input },
      timeEntries,
    );
    expect(result.startTime).toEqual(new Date(expected));
    expect(result.endTime).toEqual(new Date(expected));
  });
});

describe("sanitizeTimeEntryPush (#205)", () => {
  it("stripper prepaid-flags og returnerer pakke-id til domænelogikken", () => {
    const { clean, requestedPackageId } = sanitizeTimeEntryPush({
      description: "Arbejde",
      hours: "2.5",
      isPrepaid: true,
      prepaidPackageId: PKG,
    });
    expect(clean).not.toHaveProperty("isPrepaid");
    expect(clean).not.toHaveProperty("prepaidPackageId");
    expect(clean.description).toBe("Arbejde");
    expect(requestedPackageId).toBe(PKG);
  });

  it("isPrepaid uden pakke-id giver ingen deduktion", () => {
    const { clean, requestedPackageId } = sanitizeTimeEntryPush({
      hours: "1",
      isPrepaid: true,
    });
    expect(requestedPackageId).toBeNull();
    expect(clean).not.toHaveProperty("isPrepaid");
  });

  it("ikke-prepaid post passerer uændret igennem", () => {
    const { clean, requestedPackageId } = sanitizeTimeEntryPush({
      hours: "3",
      description: "Alm. tid",
    });
    expect(requestedPackageId).toBeNull();
    expect(clean.hours).toBe("3");
  });
});

describe("sanitizeKlippekortInsert (#205)", () => {
  it("ignorerer lokale saldi og deriverer server-side", () => {
    const clean = sanitizeKlippekortInsert({
      name: "10-timers",
      totalHours: "10",
      hourlyRate: "800",
      remainingHours: "3", // forældet lokal værdi — må ikke overleve
      usedHours: "7",
      totalValue: "999999",
      lowBalanceAlertSentAt: new Date().toISOString(),
    });
    expect(clean.remainingHours).toBe("10");
    expect(clean.usedHours).toBe("0");
    expect(clean.totalValue).toBe("8000");
    expect(clean).not.toHaveProperty("lowBalanceAlertSentAt");
  });

  it("håndterer manglende/ugyldige tal defensivt", () => {
    const clean = sanitizeKlippekortInsert({ name: "X" });
    expect(clean.remainingHours).toBe("0");
    expect(clean.usedHours).toBe("0");
  });
});

describe("sanitizeKlippekortUpdate (#205)", () => {
  it("dropper saldo-felter — serveren er autoritativ", () => {
    const clean = sanitizeKlippekortUpdate(
      {
        name: "Omdøbt",
        remainingHours: "99",
        usedHours: "0",
        lowBalanceAlertSentAt: null,
      },
      "4",
    );
    expect(clean).not.toHaveProperty("remainingHours");
    expect(clean).not.toHaveProperty("usedHours");
    expect(clean).not.toHaveProperty("lowBalanceAlertSentAt");
    expect(clean.name).toBe("Omdøbt");
  });

  it("recalculerer remaining fra serverens usedHours når totalHours ændres", () => {
    const clean = sanitizeKlippekortUpdate(
      { totalHours: "20", hourlyRate: "500" },
      "4",
    );
    expect(clean.remainingHours).toBe("16");
    expect(clean.totalValue).toBe("10000");
  });

  it("remaining kan ikke blive negativ", () => {
    const clean = sanitizeKlippekortUpdate({ totalHours: "2" }, "10");
    expect(clean.remainingHours).toBe("0");
  });

  it("totalValue recalculeres med serverens hourlyRate ved partial diff", () => {
    const clean = sanitizeKlippekortUpdate({ totalHours: "20" }, "4", "500");
    expect(clean.remainingHours).toBe("16");
    expect(clean.totalValue).toBe("10000");
  });

  it("payloadens hourlyRate vinder over serverens", () => {
    const clean = sanitizeKlippekortUpdate(
      { totalHours: "10", hourlyRate: "900" },
      "0",
      "500",
    );
    expect(clean.totalValue).toBe("9000");
  });

  it("ugyldig totalHours droppes helt", () => {
    const clean = sanitizeKlippekortUpdate({ totalHours: "abc" }, "1");
    expect(clean).not.toHaveProperty("totalHours");
    expect(clean).not.toHaveProperty("remainingHours");
  });
});

describe("pickPrimaryMembership — desktop-sync org-isolation", () => {
  const OWN = "org-egen";
  const FOREIGN = "org-fremmed";

  it("uden medlemskaber er der ingen org (solo-bruger)", () => {
    expect(pickPrimaryMembership([])).toBeNull();
  });

  it("ét medlemskab vælges uændret", () => {
    const m = {
      organizationId: OWN,
      role: "owner",
      createdAt: new Date("2026-01-01"),
    };
    expect(pickPrimaryMembership([m])?.organizationId).toBe(OWN);
  });

  it("ejer-medlemskabet vinder over et fremmed medlemskab — også når det fremmede er ældst", () => {
    // Kernen i lækagen: en bruger inviteret ind i en KUNDES org måtte aldrig
    // få kundens klippekort/fakturaer synkroniseret ned på sin enhed, blot
    // fordi databasen tilfældigvis returnerede den række først.
    const picked = pickPrimaryMembership([
      {
        organizationId: FOREIGN,
        role: "member",
        createdAt: new Date("2025-01-01"),
      },
      {
        organizationId: OWN,
        role: "owner",
        createdAt: new Date("2026-06-01"),
      },
    ]);
    expect(picked?.organizationId).toBe(OWN);
  });

  it("rækkefølgen fra databasen ændrer ikke resultatet", () => {
    const foreign = {
      organizationId: FOREIGN,
      role: "member",
      createdAt: new Date("2025-01-01"),
    };
    const own = {
      organizationId: OWN,
      role: "owner",
      createdAt: new Date("2026-06-01"),
    };
    expect(pickPrimaryMembership([own, foreign])?.organizationId).toBe(
      pickPrimaryMembership([foreign, own])?.organizationId,
    );
  });

  it("blandt flere ejer-medlemskaber vinder det ældste (samme regel som tRPC)", () => {
    const picked = pickPrimaryMembership([
      {
        organizationId: "org-ny",
        role: "owner",
        createdAt: new Date("2026-06-01"),
      },
      {
        organizationId: "org-gammel",
        role: "owner",
        createdAt: new Date("2024-02-01"),
      },
    ]);
    expect(picked?.organizationId).toBe("org-gammel");
  });

  it("uden ejer-medlemskab vinder det ældste medlemskab", () => {
    const picked = pickPrimaryMembership([
      {
        organizationId: "org-b",
        role: "member",
        createdAt: new Date("2026-03-01"),
      },
      {
        organizationId: "org-a",
        role: "admin",
        createdAt: new Date("2025-03-01"),
      },
    ]);
    expect(picked?.organizationId).toBe("org-a");
  });

  it("kommasepareret rolleliste tæller stadig som ejer", () => {
    const picked = pickPrimaryMembership([
      {
        organizationId: FOREIGN,
        role: "admin",
        createdAt: new Date("2024-01-01"),
      },
      {
        organizationId: OWN,
        role: "owner,admin",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(picked?.organizationId).toBe(OWN);
  });

  it("identisk rolle og tidspunkt brydes stabilt på org-id", () => {
    const same = new Date("2026-01-01");
    const a = { organizationId: "org-a", role: "member", createdAt: same };
    const b = { organizationId: "org-b", role: "member", createdAt: same };
    expect(pickPrimaryMembership([a, b])?.organizationId).toBe("org-a");
    expect(pickPrimaryMembership([b, a])?.organizationId).toBe("org-a");
  });

  it("medlemskaber uden org-id ignoreres", () => {
    const picked = pickPrimaryMembership([
      { organizationId: "", role: "owner", createdAt: new Date("2020-01-01") },
      {
        organizationId: OWN,
        role: "member",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(picked?.organizationId).toBe(OWN);
  });

  it("ugyldig eller manglende createdAt sorteres sidst, ikke først", () => {
    const picked = pickPrimaryMembership([
      { organizationId: FOREIGN, role: "member", createdAt: null },
      {
        organizationId: OWN,
        role: "member",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(picked?.organizationId).toBe(OWN);
  });
});

describe("coerceTimestampFields (#651)", () => {
  it("gør ISO-strenge til Date på timestamp-kolonner", () => {
    const out = coerceTimestampFields(
      {
        date: "2026-09-25T00:00:00.000Z",
        startTime: "2026-09-25T08:00:00.000Z",
        description: "2026-09-25",
      },
      timeEntries,
    );
    expect(out.date).toBeInstanceOf(Date);
    expect((out.date as Date).toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(out.startTime).toBeInstanceOf(Date);
    expect(out.description).toBe("2026-09-25");
  });

  it("lader null, Date og ugyldige værdier være", () => {
    const d = new Date("2026-09-25T10:00:00Z");
    const out = coerceTimestampFields(
      { endTime: null, startTime: d, date: "ikke en dato" },
      timeEntries,
    );
    expect(out.endTime).toBeNull();
    expect(out.startTime).toBe(d);
    expect(out.date).toBe("ikke en dato");
  });
});

describe("normalizeTimeEntryTiming (desktop-push, CEO-1 W1)", () => {
  // `date` er lagringsværdien: UTC-midnat på den danske dag (copenhagen.ts).
  // Fast reference-tidspunkt, så testen ikke afhænger af klokken.
  const NOW = new Date("2026-09-30T21:00:00Z"); // 23:00 dansk tid

  it("udleder hours fra startTime/endTime", () => {
    const clean = normalizeTimeEntryTiming({
      startTime: "2026-09-30T08:00:00Z",
      endTime: "2026-09-30T10:30:00Z",
    });
    expect(clean.hours).toBe("2.50");
  });

  it("udleder date i dansk tid, ikke UTC-dagen", () => {
    // 23:30 dansk tid = 21:30Z samme dag, men 00:30Z dagen efter ville
    // lagt posten på 1. oktober hvis datoen blev taget i UTC.
    const beforeMidnight = normalizeTimeEntryTiming({
      startTime: "2026-09-30T21:30:00Z",
      endTime: "2026-09-30T22:30:00Z",
    });
    expect((beforeMidnight.date as Date).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );

    const afterMidnight = normalizeTimeEntryTiming({
      startTime: "2026-09-30T23:30:00Z", // 01:30 dansk tid 1. oktober
      endTime: "2026-10-01T00:30:00Z",
    });
    expect((afterMidnight.date as Date).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("bruger duration som reserve, i den enhed appen angiver", () => {
    expect(
      normalizeTimeEntryTiming({ duration: 5400, durationUnit: "seconds" })
        .hours,
    ).toBe("1.50");
    expect(
      normalizeTimeEntryTiming({ duration: 90, durationUnit: "min" }).hours,
    ).toBe("1.50");
    expect(normalizeTimeEntryTiming({ duration: 2.25 }).hours).toBe("2.25");
  });

  it("date falder til nu, når hverken startTime eller endTime findes", () => {
    const clean = normalizeTimeEntryTiming({ duration: 1 }, NOW);
    expect((clean.date as Date).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("et eksplicit hours/date overrules aldrig af udledningen", () => {
    const clean = normalizeTimeEntryTiming({
      hours: "3.25",
      date: "2026-01-15",
      startTime: "2026-09-30T08:00:00Z",
      endTime: "2026-09-30T10:00:00Z",
    });
    expect(clean.hours).toBe("3.25");
    expect((clean.date as Date).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("åben timer (endTime <= startTime) giver en fejl, ikke 0 timer", () => {
    expect(() =>
      normalizeTimeEntryTiming({
        startTime: "2026-09-30T10:00:00Z",
        endTime: "2026-09-30T10:00:00Z",
      }),
    ).toThrow(/udlede timetal/);
  });

  it("post uden timetal og uden tidsstempler giver en tydelig fejl", () => {
    expect(() =>
      normalizeTimeEntryTiming({ description: "Gammel post" }),
    ).toThrow(/udlede timetal/);
  });

  it("fjerner felter der ikke er kolonner — ellers fejler insertet", () => {
    const clean = normalizeTimeEntryTiming({
      hours: "1",
      duration: 60,
      durationUnit: "minutes",
      remoteId: "server-id",
      localId: "lokal-1",
      synced: true,
      syncedAt: "2026-09-30T08:00:00Z",
    });
    for (const field of [
      "duration",
      "durationUnit",
      "remoteId",
      "localId",
      "synced",
      "syncedAt",
    ]) {
      expect(clean).not.toHaveProperty(field);
    }
    expect(clean.hours).toBe("1");
  });
});

describe("resolveSyncRemoteId (desktop-push, CEO-1 W1)", () => {
  it("foretrækker data.id, når appen har server-id'et", () => {
    expect(
      resolveSyncRemoteId({ id: "srv-1", remoteId: "cache-1" }, "l-1"),
    ).toBe("srv-1");
  });

  it("falder tilbage på remoteId fra appens cache", () => {
    expect(resolveSyncRemoteId({ remoteId: "cache-1" }, "l-1")).toBe("cache-1");
  });

  it("falder tilbage på localId som sidste udfald", () => {
    expect(resolveSyncRemoteId({ hours: "2" }, "l-1")).toBe("l-1");
  });

  it("returnerer null uden brugbart id, så kallet fejler tydeligt", () => {
    expect(resolveSyncRemoteId({ hours: "2" })).toBeNull();
    expect(resolveSyncRemoteId({ id: "  ", remoteId: "" }, "")).toBeNull();
    expect(resolveSyncRemoteId({ id: 42, remoteId: null })).toBeNull();
  });
});

describe("deriveHoursForTimeEntryUpdate (desktop-push, O9)", () => {
  it("udleder timetallet når appen kun flytter tidsrummet", () => {
    const clean = deriveHoursForTimeEntryUpdate({
      startTime: "2026-09-30T08:00:00Z",
      endTime: "2026-09-30T11:15:00Z",
    });
    expect(clean.hours).toBe("3.25");
  });

  it("udleder fra duration, når der ikke er tidsstempler", () => {
    const clean = deriveHoursForTimeEntryUpdate({
      description: "Telefon",
      duration: 2700,
      durationUnit: "seconds",
    });
    expect(clean.hours).toBe("0.75");
    expect(clean.duration).toBeUndefined();
    expect(clean.durationUnit).toBeUndefined();
  });

  it("overholder et tal appen selv har sendt", () => {
    const clean = deriveHoursForTimeEntryUpdate({
      hours: "1.5",
      startTime: "2026-09-30T08:00:00Z",
      endTime: "2026-09-30T11:15:00Z",
    });
    expect(clean.hours).toBe("1.5");
  });

  it("lader en update uden tidsdata være i fred", () => {
    const clean = deriveHoursForTimeEntryUpdate({ description: "Ny tekst" });
    expect(clean).toEqual({ description: "Ny tekst" });
  });

  it("flytter aldrig datoen — det kunne smutte forbi periodelåsen", () => {
    const clean = deriveHoursForTimeEntryUpdate({
      startTime: "2026-10-01T08:00:00Z",
      endTime: "2026-10-01T09:00:00Z",
    });
    expect(clean.date).toBeUndefined();
  });

  it("gætter ikke 0 timer på en åben timer", () => {
    const clean = deriveHoursForTimeEntryUpdate({
      startTime: "2026-09-30T08:00:00Z",
    });
    expect(clean.hours).toBeUndefined();
  });
});

describe("scopeClientEntryId (desktop-push, O11)", () => {
  const USER = "11111111-1111-1111-1111-111111111111";
  const OTHER_USER = "22222222-2222-2222-2222-222222222222";
  const DEVICE = "33333333-3333-3333-3333-333333333333";
  const OTHER_DEVICE = "44444444-4444-4444-4444-444444444444";
  const KEY = "9f6d0f0e-1a2b-4c3d-8e5f-000000000001";

  it("lader en uuid gå uændret igennem", () => {
    // En uuid er globalt unik, så extensionens egne poster og alt skrevet
    // før afledningen stadig genfindes med præcis samme nøgle.
    expect(scopeClientEntryId(KEY, USER, DEVICE)).toBe(KEY);
  });

  it("isolerer også UUID'er når extensionen vælger brugerscoping", () => {
    expect(scopeClientEntryId(KEY, USER, "extension", true)).not.toBe(KEY);
    expect(scopeClientEntryId(KEY, USER, "extension", true)).not.toBe(
      scopeClientEntryId(KEY, OTHER_USER, "extension", true),
    );
  });

  it("lader den samme nølle igen finde den samme post", () => {
    // Idempotensen er afhængig af at afledningen er deterministisk: en
    // gentagelse efter tabt svar skal ramme unique-indekset OG genfindes.
    expect(scopeClientEntryId("42", USER, DEVICE)).toBe(
      scopeClientEntryId("42", USER, DEVICE),
    );
  });

  it("giver to brugere hver sin nøgle på samme lokale id", () => {
    // Før afledningen undertrykkedes den andens indsættelse af det GLOBALE
    // unique-indeks, mens genfindelsen filtrerede på userId og derfor aldrig
    // fandt noget: posten kunne ikke oprettes, uanset hvor mange gange appen
    // prøvede.
    expect(scopeClientEntryId("42", USER, DEVICE)).not.toBe(
      scopeClientEntryId("42", OTHER_USER, DEVICE),
    );
  });

  it("giver to enheder hos samme bruger hver sin nøgle", () => {
    // Ellers fik den anden enhed den førstes remoteId og overskrev dens
    // indlæg ved næste update.
    expect(scopeClientEntryId("42", USER, DEVICE)).not.toBe(
      scopeClientEntryId("42", USER, OTHER_DEVICE),
    );
  });

  it("skelner mellem forskellige lokale id på samme enhed", () => {
    expect(scopeClientEntryId("42", USER, DEVICE)).not.toBe(
      scopeClientEntryId("43", USER, DEVICE),
    );
  });

  it("afleder en nøgle der kan passe i varchar(36)", () => {
    const scoped = scopeClientEntryId("42", USER, DEVICE);
    expect(scoped).not.toBeNull();
    expect(scoped?.length).toBeLessThanOrEqual(36);
    // `c`-præfiks holder den afledte nøgle adskilt fra en uuid, så en afledet
    // nølle aldrig kan læses som en rå uuid (og omvendt).
    expect(scoped).toMatch(/^c[\w-]{22}$/);
    expect(scoped).not.toBe("42");
  });

  it("afviser nøgler der ikke kan bruges som idempotensnøgle", () => {
    expect(scopeClientEntryId(undefined, USER, DEVICE)).toBeNull();
    expect(scopeClientEntryId(42, USER, DEVICE)).toBeNull();
    expect(scopeClientEntryId("", USER, DEVICE)).toBeNull();
    expect(scopeClientEntryId("   ", USER, DEVICE)).toBeNull();
    // Længere end kolonnen, så den ville fejle selve indsættelsen.
    expect(scopeClientEntryId("x".repeat(37), USER, DEVICE)).toBeNull();
  });

  it("ignorerer omgivende mellemrum i nøglen", () => {
    expect(scopeClientEntryId(" 42 ", USER, DEVICE)).toBe(
      scopeClientEntryId("42", USER, DEVICE),
    );
  });
});

describe("desktop-datoer på den danske dag (#650)", () => {
  it("lægger en pullet `date` som råt tidspunkt på den danske dag", () => {
    // 22:30Z den 15. er 00:30 dansk tid den 16. (sommertid)
    const clean = normalizeTimeEntryTiming({
      hours: "1",
      date: "2026-07-15T22:30:00.000Z",
    });
    expect((clean.date as Date).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("tåler en ældre række gemt på dansk midnat", () => {
    const clean = normalizeTimeEntryTiming({
      hours: "1",
      date: new Date("2026-07-15T22:00:00.000Z"),
    });
    expect((clean.date as Date).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("normaliserer en eksplicit dato på update og rører intet uden", () => {
    const moved = normalizeTimeEntryUpdateDate({
      date: "2026-01-15T23:30:00Z", // 00:30 dansk tid den 16. (vintertid)
    });
    expect((moved.date as Date).toISOString()).toBe("2026-01-16T00:00:00.000Z");

    const untouched = normalizeTimeEntryUpdateDate({ description: "x" });
    expect(untouched).not.toHaveProperty("date");

    const nulled = normalizeTimeEntryUpdateDate({ date: null });
    expect(nulled).not.toHaveProperty("date");
  });
});
