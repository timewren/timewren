import { describe, expect, it } from "vitest";
import {
  type ExistingCalDavEvent,
  type IncomingCalDavEvent,
  planCalDavSync,
} from "../sync-plan";

function incoming(
  overrides: Partial<IncomingCalDavEvent> = {},
): IncomingCalDavEvent {
  return {
    externalId: "caldav:uid-1",
    uid: "uid-1",
    title: "Kundemøde",
    description: "Agenda",
    location: "Kontoret",
    startTime: new Date("2026-09-30T08:00:00Z"),
    endTime: new Date("2026-09-30T09:00:00Z"),
    isAllDay: false,
    timezone: "Europe/Copenhagen",
    isCancelled: false,
    responseStatus: null,
    etag: '"e1"',
    ...overrides,
  };
}

function existing(
  overrides: Partial<ExistingCalDavEvent> = {},
): ExistingCalDavEvent {
  return {
    id: "row-1",
    externalId: "caldav:uid-1",
    externalEtag: '"e1"',
    title: "Kundemøde",
    description: "Agenda",
    location: "Kontoret",
    startTime: new Date("2026-09-30T08:00:00Z"),
    endTime: new Date("2026-09-30T09:00:00Z"),
    isAllDay: false,
    responseStatus: null,
    isCancelled: false,
    ...overrides,
  };
}

const plain = { privacyMode: "off" as const, filters: null };

describe("planCalDavSync", () => {
  it("indsætter nye hændelser", () => {
    const plan = planCalDavSync([], [incoming()], plain);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      externalId: "caldav:uid-1",
      title: "Kundemøde",
      externalEtag: '"e1"',
    });
    expect(plan.updates).toEqual([]);
    expect(plan.cancels).toEqual([]);
  });

  it("gør intet når intet har ændret sig", () => {
    const plan = planCalDavSync([existing()], [incoming()], plain);
    expect(plan).toEqual({
      inserts: [],
      updates: [],
      cancels: [],
      filtered: 0,
    });
  });

  it("opdaterer flyttede hændelser", () => {
    const plan = planCalDavSync(
      [existing()],
      [
        incoming({
          startTime: new Date("2026-09-30T10:00:00Z"),
          endTime: new Date("2026-09-30T11:00:00Z"),
          etag: '"e2"',
        }),
      ],
      plain,
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe("row-1");
    expect(plan.updates[0].values.startTime.toISOString()).toBe(
      "2026-09-30T10:00:00.000Z",
    );
  });

  it("markerer hændelser slettet i iCloud som aflyst", () => {
    const plan = planCalDavSync([existing()], [], plain);
    expect(plan.cancels).toEqual(["row-1"]);
  });

  it("lader manglende hændelser stå, når nogle objekter ikke kunne læses", () => {
    const plan = planCalDavSync([existing()], [], {
      ...plain,
      cancelMissing: false,
    });
    expect(plan.cancels).toEqual([]);
  });

  it("markerer STATUS:CANCELLED som aflyst og genopliver en gendannet hændelse", () => {
    expect(
      planCalDavSync([existing()], [incoming({ isCancelled: true })], plain)
        .cancels,
    ).toEqual(["row-1"]);

    const revived = planCalDavSync(
      [existing({ isCancelled: true })],
      [incoming()],
      plain,
    );
    expect(revived.updates).toHaveLength(1);
    expect(revived.updates[0].values.isCancelled).toBe(false);
  });

  it("anvender synk-filtre (ignorer-ord, varighed, heldag, afviste)", () => {
    const filters = {
      ignoreWords: ["frokost"],
      minDurationMinutes: 15,
      ignoreAllDay: true,
      onlyAccepted: true,
    };
    const plan = planCalDavSync(
      [existing({ id: "row-lunch", externalId: "caldav:lunch" })],
      [
        incoming({ externalId: "caldav:lunch", title: "Frokost" }),
        incoming({
          externalId: "caldav:short",
          endTime: new Date("2026-09-30T08:10:00Z"),
        }),
        incoming({ externalId: "caldav:allday", isAllDay: true }),
        incoming({ externalId: "caldav:declined", responseStatus: "declined" }),
        incoming({ externalId: "caldav:ok" }),
      ],
      { privacyMode: "off", filters },
    );
    expect(plan.filtered).toBe(4);
    expect(plan.inserts.map((e) => e.externalId)).toEqual(["caldav:ok"]);
    // En eksisterende hændelse, der nu filtreres fra, fjernes fra visningen
    expect(plan.cancels).toEqual(["row-lunch"]);
  });

  it("maskerer titel, beskrivelse og sted i privatlivstilstand", () => {
    const plan = planCalDavSync([], [incoming()], {
      privacyMode: "mask_titles",
      filters: null,
    });
    expect(plan.inserts[0]).toMatchObject({
      title: "Optaget",
      description: null,
      location: null,
    });
  });

  it("springer nye hændelser uden titel over (som Google)", () => {
    const plan = planCalDavSync([], [incoming({ title: null })], plain);
    expect(plan.inserts).toEqual([]);
  });

  it("ignorerer dubletter af samme nøgle", () => {
    const plan = planCalDavSync([], [incoming(), incoming()], plain);
    expect(plan.inserts).toHaveLength(1);
  });
});
