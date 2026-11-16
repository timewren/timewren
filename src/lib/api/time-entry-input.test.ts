import { describe, expect, it } from "vitest";
import {
  dateMoveRestampCheck,
  type ExistingTimeEntry,
  mergeTimeEntryPatch,
  normalizeBillableRate,
  toTimeListQuery,
} from "./time-entry-input";

const CLIENT_A = "22222222-2222-2222-2222-222222222222";
const CLIENT_B = "44444444-4444-4444-4444-444444444444";

const existing: ExistingTimeEntry = {
  projectId: "11111111-1111-1111-1111-111111111111",
  clientId: CLIENT_A,
  description: "Oprindelig beskrivelse",
  notes: "En note",
  hours: "1.50",
  date: "2026-09-10",
  startTime: new Date("2026-09-10T05:00:00.000Z"),
  endTime: new Date("2026-09-10T06:30:00.000Z"),
  isBillable: true,
  isBilled: false,
  taskId: "33333333-3333-3333-3333-333333333333",
  billableRate: "850.00",
};

/** Pakker resultatet ud, eller fejler testen med fejlbeskeden. */
function merged(body: Record<string, unknown>) {
  const result = mergeTimeEntryPatch(existing, body);
  if (!result.ok) {
    throw new Error(
      `forventede ok, fik fejl på ${result.field}: ${result.message}`,
    );
  }
  return result.value;
}

describe("normalizeBillableRate", () => {
  it("beholder en gyldig streng", () => {
    expect(normalizeBillableRate("900")).toBe("900");
    expect(normalizeBillableRate("812.50")).toBe("812.50");
  });

  it("accepterer et tal, så en sats ikke kasseres tavst", () => {
    expect(normalizeBillableRate(900)).toBe("900");
    expect(normalizeBillableRate(812.5)).toBe("812.5");
  });

  it("afrunder til to decimaler i stedet for at lade Postgres gøre det", () => {
    expect(normalizeBillableRate(900.567)).toBe("900.57");
    expect(normalizeBillableRate(900.5)).toBe("900.5");
  });

  it("sender ikke eksponent-notation videre til databasen", () => {
    // String(1e21) === "1e+21", som Postgres' numeric afviser med en 500
    expect(normalizeBillableRate(1e21)).toBeUndefined();
  });

  it("accepterer dansk decimalkomma", () => {
    expect(normalizeBillableRate("812,50")).toBe("812.50");
  });

  it("afviser værdier der ellers ville give en databasefejl", () => {
    // Uden mønstertjek nåede "abc" hele vejen til Postgres og gav 500
    expect(normalizeBillableRate("abc")).toBeUndefined();
    expect(normalizeBillableRate("")).toBeUndefined();
    expect(normalizeBillableRate("   ")).toBeUndefined();
    expect(normalizeBillableRate(-100)).toBeUndefined();
    expect(normalizeBillableRate(Number.NaN)).toBeUndefined();
    expect(normalizeBillableRate(undefined)).toBeUndefined();
    expect(normalizeBillableRate({})).toBeUndefined();
  });
});

describe("mergeTimeEntryPatch", () => {
  it("bevarer klient og sats når kun klokkeslæt sendes", () => {
    const value = merged({
      startTime: "2026-09-10T07:00:00.000Z",
      endTime: "2026-09-10T08:30:00.000Z",
    });

    expect(value.clientId).toBe(CLIENT_A);
    expect(value.billableRate).toBe("850.00");
    expect(value.projectId).toBe(existing.projectId);
    expect(value.description).toBe("Oprindelig beskrivelse");
    expect(value.hours).toBe(1.5);
    expect(value.date).toBe("2026-09-10");
    expect(value.startTime).toBe("2026-09-10T07:00:00.000Z");
  });

  it("bevarer alt når bodyen er tom", () => {
    expect(merged({})).toEqual({
      projectId: existing.projectId,
      clientId: CLIENT_A,
      description: "Oprindelig beskrivelse",
      notes: "En note",
      hours: 1.5,
      date: "2026-09-10",
      startTime: "2026-09-10T05:00:00.000Z",
      endTime: "2026-09-10T06:30:00.000Z",
      isBillable: true,
      isBilled: false,
      taskId: existing.taskId,
      billableRate: "850.00",
    });
  });

  it("overskriver kun de sendte felter", () => {
    const value = merged({
      description: "Ny beskrivelse",
      hours: 2,
      isBillable: false,
    });

    expect(value.description).toBe("Ny beskrivelse");
    expect(value.hours).toBe(2);
    expect(value.isBillable).toBe(false);
    expect(value.clientId).toBe(CLIENT_A);
    expect(value.billableRate).toBe("850.00");
  });

  describe("sats ved skift af klient eller projekt", () => {
    it("slipper satsen så hierarkiet genberegner den for den nye klient", () => {
      // Uden dette ville en post flyttet til en dyrere kunde beholde 850.
      const value = merged({ clientId: CLIENT_B });
      expect(value.clientId).toBe(CLIENT_B);
      expect(value.billableRate).toBeUndefined();
    });

    it("slipper også satsen ved projektskift", () => {
      const value = merged({
        projectId: "55555555-5555-5555-5555-555555555555",
      });
      expect(value.billableRate).toBeUndefined();
    });

    it("respekterer en sats klienten selv sender ved klientskift", () => {
      const value = merged({ clientId: CLIENT_B, billableRate: 1200 });
      expect(value.billableRate).toBe("1200");
    });

    it("beholder satsen når klienten sendes uændret med", () => {
      const value = merged({ clientId: CLIENT_A, description: "Rettet" });
      expect(value.billableRate).toBe("850.00");
    });
  });

  describe("null", () => {
    it("rydder de felter hvor det faktisk virker", () => {
      const value = merged({ clientId: null, taskId: null, notes: null });
      expect(value.clientId).toBeUndefined();
      expect(value.taskId).toBeUndefined();
      expect(value.notes).toBeUndefined();
      expect(value.description).toBe("Oprindelig beskrivelse");
    });

    it("fjerner klippekort-trækket", () => {
      const value = merged({ prepaidPackageId: null });
      expect(value.prepaidPackageId).toBeNull();
    });

    // Disse felter kunne ikke ryddes med null — før gav det et tavst no-op,
    // så klienten troede feltet var fjernet.
    it.each(["startTime", "endTime", "isBillable", "isBilled", "billableRate"])(
      "afviser null på %s i stedet for at ignorere det",
      (field) => {
        const result = mergeTimeEntryPatch(existing, { [field]: null });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.field).toBe(field);
        expect(result.message).toContain("null");
      },
    );
  });

  describe("forkerte typer", () => {
    // Tidligere blev en forkert type læst som "ryd feltet": {clientId: 12345}
    // fjernede klienten og rullede klippekort-trækket tilbage.
    it("afviser et tal som clientId frem for at rydde klienten", () => {
      const result = mergeTimeEntryPatch(existing, { clientId: 12345 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.field).toBe("clientId");
    });

    it.each([
      ["projectId", 1],
      ["taskId", true],
      ["description", 42],
      ["isBillable", "ja"],
      ["startTime", 1757480400],
      ["billableRate", "abc"],
      ["prepaidPackageId", 7],
      ["fromTimer", "ja"],
    ])("afviser %s med forkert type", (field, value) => {
      const result = mergeTimeEntryPatch(existing, { [field]: value });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.field).toBe(field);
    });
  });

  describe("værdier fra databasen", () => {
    it("håndterer dato og timer som Date og tal", () => {
      const value = mergeTimeEntryPatch(
        { ...existing, date: new Date(2026, 8, 11, 14, 30), hours: 3 },
        { description: "Rettet" },
      );
      expect(value.ok).toBe(true);
      if (!value.ok) return;
      // Lokal dato, ikke UTC — ellers flytter posten sig en dag ved en PATCH
      // der kun retter beskrivelsen.
      expect(value.value.date).toBe("2026-09-11");
      expect(value.value.hours).toBe(3);
    });

    it("håndterer en post uden tidsrum", () => {
      const value = mergeTimeEntryPatch(
        { ...existing, startTime: null, endTime: null },
        { description: "Rettet" },
      );
      expect(value.ok).toBe(true);
      if (!value.ok) return;
      expect(value.value.startTime).toBeUndefined();
      expect(value.value.endTime).toBeUndefined();
    });
  });

  // Uden denne test vil næste felt der tilføjes til time.update's input tavst
  // blive nulstillet ved hver PATCH — præcis den fejl fletningen fikser.
  it("dækker alle felter der kan opdateres", () => {
    const covered = Object.keys(merged({}));
    const alsoHandled = ["prepaidPackageId", "fromTimer"];
    const expectedFields = [
      "projectId",
      "clientId",
      "description",
      "notes",
      "hours",
      "date",
      "startTime",
      "endTime",
      "isBillable",
      "isBilled",
      "taskId",
      "billableRate",
    ];
    expect(covered.sort()).toEqual(expectedFields.sort());
    for (const field of alsoHandled) {
      const result = mergeTimeEntryPatch(existing, { [field]: null });
      // Feltet skal give et resultat (rydning eller afvisning), ikke ignoreres
      expect(result).toBeDefined();
    }
  });
});

describe("dateMoveRestampCheck", () => {
  const check = (body: Record<string, unknown>, base = existing) =>
    dateMoveRestampCheck(base, body, merged(body));

  it("melder den gamle dato når en ufaktureret post flyttes", () => {
    expect(check({ date: "2026-11-03" })).toEqual({
      previousDate: "2026-09-10",
    });
  });

  it("gør intet når datoen sendes uændret", () => {
    expect(check({ date: "2026-09-10" })).toBeNull();
  });

  it("gør intet uden dato i bodyen", () => {
    expect(check({ description: "Rettet" })).toBeNull();
  });

  it("respekterer en sats klienten selv sender", () => {
    expect(check({ date: "2026-11-03", billableRate: "900" })).toBeNull();
  });

  it("rører ikke fakturerede poster", () => {
    const billed = { ...existing, isBilled: true };
    expect(
      dateMoveRestampCheck(
        billed,
        { date: "2026-11-03" },
        (() => {
          const r = mergeTimeEntryPatch(billed, { date: "2026-11-03" });
          if (!r.ok) throw new Error(r.message);
          return r.value;
        })(),
      ),
    ).toBeNull();
  });

  it("gør intet når satsen allerede er sluppet pga. klientskift", () => {
    expect(check({ date: "2026-11-03", clientId: CLIENT_B })).toBeNull();
  });
});

describe("toTimeListQuery", () => {
  it("beder databasen om netop den side klienten spurgte om", () => {
    expect(toTimeListQuery(1, 25, "date", "desc")).toEqual({
      limit: 25,
      offset: 0,
      includeTotal: true,
      sortBy: "date",
      sortOrder: "desc",
    });
    expect(toTimeListQuery(3, 25, "date", "desc").offset).toBe(50);
    expect(toTimeListQuery(2, 100, "date", "desc").offset).toBe(100);
  });

  it("beder altid om totalen, så pagination.total er det rigtige tal", () => {
    // Uden denne rapporterede API'et antallet på den hentede side som total
    expect(toTimeListQuery(1, 25, "date", "desc").includeTotal).toBe(true);
  });

  it("sender sorteringen med, så side 2 indeholder de rigtige rækker", () => {
    expect(toTimeListQuery(1, 25, "hours", "asc")).toMatchObject({
      sortBy: "hours",
      sortOrder: "asc",
    });
    expect(toTimeListQuery(1, 25, "createdAt", "desc").sortBy).toBe(
      "createdAt",
    );
  });

  it("falder tilbage til dato ved et ukendt sorteringsfelt", () => {
    expect(toTimeListQuery(1, 25, "description", "desc").sortBy).toBe("date");
  });

  it("giver aldrig et negativt offset", () => {
    expect(toTimeListQuery(0, 25, "date", "desc").offset).toBe(0);
  });
});
