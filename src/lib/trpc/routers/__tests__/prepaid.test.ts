/**
 * Klippekort-pengevejen (#1113): testene kører den RIGTIGE kode —
 * `deductHoursCore`, `reversePrepaidUsage` og `checkAndSendLowBalanceAlert` fra
 * src/lib/trpc/routers/prepaid.ts — mod en in-memory-tx, der fanger hver
 * skrivning. Tidligere lå en kopi af træk-matematikken i testen selv, så
 * ingen af de grønne tests sagde noget om koden i src (udløb, overtræks-
 * politik og kunde-tjek var slet ikke dækket).
 *
 * Rene hjælpere (afrunding, saldo-niveau, udløb) har egne tests i
 * src/lib/prepaid/*.test.ts og gentages ikke her.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/lib/portal/client-url", () => ({
  getClientPortalUrl: vi.fn(async () => "https://portal.example.com/abc"),
}));
// Adgangskontrollen har egne tests (clientAccess.test.ts); her skal den bare
// slippe trækket igennem, så matematikken er emnet.
vi.mock("../clientAccess", () => ({
  assertClientAccess: vi.fn(),
  getAccessibleClientIds: vi.fn(),
}));

import { prepaidPackages, prepaidUsage, timeEntries } from "@/lib/db/schema";
import { sendLowBalanceAlert } from "@/lib/email/prepaid";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { appCodeOf } from "../../app-code";
import {
  checkAndSendLowBalanceAlert,
  deductHoursCore,
  reversePrepaidUsage,
} from "../prepaid";

const USER = "user-prepaid";
const ORG = "org-prepaid";
const PACKAGE = "pkg-1";
const CLIENT = "client-1";
const ENTRY = "entry-1";

const dialect = new PgDialect();
/** Parametrene i et sql``-udtryk, så LEAST/GREATEST-skrivninger kan efterses. */
function sqlParams(value: unknown): unknown[] {
  return dialect.sqlToQuery(value as SQL).params;
}

type Pkg = Record<string, unknown> & { id: string };

function pkgRow(over: Partial<Pkg> = {}): Pkg {
  return {
    id: PACKAGE,
    userId: USER,
    organizationId: ORG,
    clientId: CLIENT,
    name: "Udviklingspakke 20 timer",
    totalHours: "20",
    usedHours: "5",
    remainingHours: "15",
    hourlyRate: "800",
    clipSizeMinutes: null,
    overdraftPolicy: "block",
    overdraftRate: null,
    overdraftHours: "0",
    // Fremtidigt udløb: et udløbet kort afviser trækket (#206), hvilket
    // testen "afviser et udløbet kort" dækker eksplicit.
    expiryDate: new Date("2099-12-31T00:00:00Z"),
    isActive: true,
    lowBalanceAlertSentAt: null,
    ...over,
  };
}

type Write = { table: unknown; values: Record<string, unknown> };

function makeTx(pkg: Pkg | null, usage: Record<string, unknown>[] = []) {
  const updates: Write[] = [];
  const inserts: Write[] = [];
  const deletes: unknown[] = [];
  const locks: unknown[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: async (mode: string) => {
            locks.push({ table, mode });
            return pkg ? [pkg] : [];
          },
        }),
      }),
    }),
    query: { prepaidUsage: { findMany: async () => usage } },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          inserts.push({ table, values });
          return [{ id: "usage-row-1" }];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deletes.push(table);
      },
    }),
  };
  return { tx, updates, inserts, deletes, locks };
}

function writeTo(writes: Write[], table: unknown) {
  return writes.find((w) => w.table === table)?.values;
}

function deduct(
  tx: unknown,
  options: {
    hours: number;
    timeEntryId?: string;
    clientId?: string | null;
    allowInactive?: boolean;
  },
) {
  return deductHoursCore(tx as never, USER, ORG, {
    packageId: PACKAGE,
    hours: options.hours,
    timeEntryId: options.timeEntryId,
    clientId: options.clientId === undefined ? CLIENT : options.clientId,
    allowInactive: options.allowInactive,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("deductHoursCore — saldoen efter et træk", () => {
  it("trækker timerne, skriver saldoen og bogfører forbruget", async () => {
    const { tx, updates, inserts, locks } = makeTx(pkgRow());

    const result = await deduct(tx, { hours: 3, timeEntryId: ENTRY });

    expect(result.hoursDeducted).toBe(3);
    expect(result.remainingHours).toBe(12);
    expect(result.overdraftedHours).toBeUndefined();
    expect(writeTo(updates, prepaidPackages)).toMatchObject({
      usedHours: "8",
      remainingHours: "12",
    });
    expect(writeTo(inserts, prepaidUsage)).toMatchObject({
      prepaidPackageId: PACKAGE,
      timeEntryId: ENTRY,
      hoursUsed: "3",
      valueUsed: "2400",
      overdraftHours: "0",
    });
    // Posten markeres prepaid, så den ikke også kan faktureres.
    expect(writeTo(updates, timeEntries)).toEqual({
      prepaidPackageId: PACKAGE,
      isPrepaid: true,
    });
    // Rækken låses før saldoen læses — ellers kan to samtidige træk
    // dobbelt-bruge de samme timer.
    expect(locks).toEqual([{ table: prepaidPackages, mode: "no key update" }]);
  });

  it("afrunder til databasens skala, så brugt + tilbage = total", async () => {
    const { tx, updates } = makeTx(
      pkgRow({ totalHours: "40", usedHours: "0", remainingHours: "40" }),
    );

    const result = await deduct(tx, { hours: 2.855 });

    expect(result.hoursDeducted).toBe(2.86);
    const values = writeTo(updates, prepaidPackages);
    expect(values).toMatchObject({
      usedHours: "2.86",
      remainingHours: "37.14",
    });
    expect(
      Number(values?.usedHours) + Number(values?.remainingHours),
    ).toBeCloseTo(40, 10);
  });

  it("runder op til hele klip og bogfører klip-timerne", async () => {
    const { tx, updates, inserts } = makeTx(
      pkgRow({
        totalHours: "1",
        usedHours: "0",
        remainingHours: "1",
        clipSizeMinutes: 5,
        hourlyRate: "600",
      }),
    );

    const result = await deduct(tx, { hours: 0.01 });

    expect(result.hoursDeducted).toBe(0.09);
    expect(writeTo(updates, prepaidPackages)).toMatchObject({
      usedHours: "0.09",
      remainingHours: "0.91",
    });
    expect(writeTo(inserts, prepaidUsage)).toMatchObject({
      hoursUsed: "0.09",
      valueUsed: "54",
    });
  });

  it("tømmer kortet præcist når trækket er hele restsaldoen", async () => {
    const { tx, updates } = makeTx(
      pkgRow({ usedHours: "15", remainingHours: "5" }),
    );

    const result = await deduct(tx, { hours: 5 });

    expect(result.remainingHours).toBe(0);
    expect(writeTo(updates, prepaidPackages)).toMatchObject({
      usedHours: "20",
      remainingHours: "0",
    });
  });
});

describe("deductHoursCore — overtræks-politik (#93)", () => {
  it("block: afviser med restsaldoen og skriver ingenting", async () => {
    const { tx, updates, inserts } = makeTx(
      pkgRow({ usedHours: "17", remainingHours: "3" }),
    );

    await expect(deduct(tx, { hours: 5 })).rejects.toThrow(
      /Ikke nok timer tilbage på klippekortet. Tilgængelige timer: 3.00/,
    );
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("alle afvisninger bærer den sprogneutrale kode (#1320)", async () => {
    // Udvidelsen gemmer tiden uden kort, når koden er sat. Teksten er
    // oversat, så den må ikke være det eneste kendetegn.
    const cases: Array<[Pkg | null, Parameters<typeof deduct>[1]]> = [
      [null, { hours: 1 }],
      [pkgRow({ usedHours: "17", remainingHours: "3" }), { hours: 5 }],
      [pkgRow({ isActive: false }), { hours: 1 }],
      [pkgRow({ expiryDate: new Date("2020-01-01T00:00:00Z") }), { hours: 1 }],
      [pkgRow(), { hours: 1, timeEntryId: ENTRY, clientId: "client-2" }],
      [pkgRow(), { hours: 0 }],
    ];
    for (const [pkg, opts] of cases) {
      const { tx } = makeTx(pkg);
      const error = await deduct(tx, opts).catch((e: unknown) => e);
      expect(appCodeOf(error)).toBe("PREPAID_DEDUCTION_FAILED");
    }
  });

  it("block med klip: fortæller også det oprundede krav", async () => {
    const { tx } = makeTx(
      pkgRow({ usedHours: "19.5", remainingHours: "0.5", clipSizeMinutes: 30 }),
    );

    await expect(deduct(tx, { hours: 1.2 })).rejects.toThrow(
      /kræver 1.50t \(oprundet til 30 min klip\)/,
    );
  });

  it("allow: trækker resten og lægger overtrækket som gæld", async () => {
    const { tx, updates, inserts } = makeTx(
      pkgRow({
        usedHours: "17",
        remainingHours: "3",
        overdraftPolicy: "allow",
      }),
    );

    const result = await deduct(tx, { hours: 5, timeEntryId: ENTRY });

    expect(result.overdraftedHours).toBe(2);
    expect(result.remainingHours).toBe(0);
    expect(result.hoursDeducted).toBe(5);
    const pkgValues = writeTo(updates, prepaidPackages);
    expect(pkgValues).toMatchObject({ usedHours: "20", remainingHours: "0" });
    // Gælden lægges oven i den eksisterende via SQL, ikke ved at overskrive.
    expect(sqlParams(pkgValues?.overdraftHours)).toEqual([2]);
    // Overtræks-andelen gemmes pr. forbrugsrække, så en reversal kan
    // attribuere eksakt.
    expect(writeTo(inserts, prepaidUsage)).toMatchObject({
      hoursUsed: "5",
      overdraftHours: "2",
    });
  });

  it("invoice: rører ikke kortet og gør posten fakturerbar til overtræks-satsen", async () => {
    const { tx, updates, inserts } = makeTx(
      pkgRow({
        usedHours: "17",
        remainingHours: "3",
        overdraftPolicy: "invoice",
        overdraftRate: "950",
      }),
    );

    const result = await deduct(tx, { hours: 5, timeEntryId: ENTRY });

    expect(result).toMatchObject({
      overflowedToInvoice: true,
      hoursDeducted: 0,
      remainingHours: 3,
      usageId: null,
    });
    expect(writeTo(updates, prepaidPackages)).toBeUndefined();
    expect(inserts).toEqual([]);
    expect(writeTo(updates, timeEntries)).toEqual({
      isPrepaid: false,
      prepaidPackageId: null,
      isBillable: true,
      billableRate: "950",
    });
  });
});

describe("deductHoursCore — vagter før pengene flytter", () => {
  it("afviser et inaktivt kort, men lader allowInactive frigive timer", async () => {
    const inactive = () => makeTx(pkgRow({ isActive: false }));

    const blocked = inactive();
    await expect(deduct(blocked.tx, { hours: 1 })).rejects.toThrow(
      "Klippekort er ikke aktivt",
    );
    expect(blocked.updates).toEqual([]);

    const allowed = inactive();
    await expect(
      deduct(allowed.tx, { hours: 1, allowInactive: true }),
    ).resolves.toMatchObject({ hoursDeducted: 1 });
  });

  it("afviser et udløbet kort (#206)", async () => {
    const { tx, updates } = makeTx(
      pkgRow({ expiryDate: new Date("2020-01-01T00:00:00Z") }),
    );

    await expect(deduct(tx, { hours: 1 })).rejects.toThrow(
      "Klippekortet er udløbet",
    );
    expect(updates).toEqual([]);
  });

  it("afviser en post fra en anden kunde end kortets", async () => {
    const { tx, updates } = makeTx(pkgRow());

    await expect(
      deduct(tx, { hours: 1, timeEntryId: ENTRY, clientId: "client-2" }),
    ).rejects.toThrow(
      "Klippekortet tilhører en anden kunde end tidspostens klient",
    );
    expect(updates).toEqual([]);
  });

  it("lader manuelle træk uden tidspost slippe kunde-tjekket", async () => {
    const { tx } = makeTx(pkgRow());

    await expect(
      deduct(tx, { hours: 1, clientId: null }),
    ).resolves.toMatchObject({ hoursDeducted: 1 });
  });

  it("afviser NaN, nul og negative timer uden at skrive", async () => {
    for (const hours of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) {
      const { tx, updates, inserts } = makeTx(pkgRow());
      await expect(deduct(tx, { hours })).rejects.toThrow(
        "Ugyldigt timetal til klippekort-traek",
      );
      expect(updates).toEqual([]);
      expect(inserts).toEqual([]);
    }
  });

  it("afviser et træk der afrundes til nul", async () => {
    const { tx, updates } = makeTx(pkgRow());

    await expect(deduct(tx, { hours: 0.001 })).rejects.toThrow(
      "Ugyldigt timetal til klippekort-traek",
    );
    expect(updates).toEqual([]);
  });

  it("afviser et kort uden for brugerens org", async () => {
    const { tx, updates } = makeTx(null);

    await expect(deduct(tx, { hours: 1 })).rejects.toThrow(
      "Klippekort ikke fundet",
    );
    expect(updates).toEqual([]);
  });
});

describe("reversePrepaidUsage", () => {
  it("lægger kun de saldo-dækkede timer tilbage og nulstiller gælden", async () => {
    const { tx, updates, deletes, locks } = makeTx(pkgRow(), [
      { hoursUsed: "5", overdraftHours: "3" },
    ]);

    const restored = await reversePrepaidUsage(tx as never, ENTRY, PACKAGE);

    expect(restored).toBe(5);
    const values = writeTo(updates, prepaidPackages);
    // 5 brugte timer, hvoraf 3 var overtræk: 2 går tilbage på saldoen.
    expect(sqlParams(values?.remainingHours)).toEqual([2]);
    expect(sqlParams(values?.usedHours)).toEqual([2]);
    expect(sqlParams(values?.overdraftHours)).toEqual([3]);
    // Lav-saldo-mailen må kunne sendes igen, når saldoen er oppe.
    expect(values?.lowBalanceAlertSentAt).toBeNull();
    expect(deletes).toEqual([prepaidUsage]);
    expect(locks).toEqual([{ table: prepaidPackages, mode: "no key update" }]);
  });

  it("summerer flere forbrugsrækker for samme post", async () => {
    const { tx, updates } = makeTx(pkgRow(), [
      { hoursUsed: "2", overdraftHours: "0" },
      { hoursUsed: "1.5", overdraftHours: "0" },
    ]);

    expect(await reversePrepaidUsage(tx as never, ENTRY, PACKAGE)).toBe(3.5);
    expect(
      sqlParams(writeTo(updates, prepaidPackages)?.remainingHours),
    ).toEqual([3.5]);
  });

  it("skriver ikke på kortet når posten ikke har forbrug", async () => {
    const { tx, updates, deletes } = makeTx(pkgRow(), []);

    expect(await reversePrepaidUsage(tx as never, ENTRY, PACKAGE)).toBe(0);
    expect(updates).toEqual([]);
    // Oprydningen kører stadig, så der ikke ligger forældede rækker.
    expect(deletes).toEqual([prepaidUsage]);
  });
});

describe("checkAndSendLowBalanceAlert", () => {
  function alertDb(over: { prepaidAlertRecipient?: string } = {}) {
    const updates: Record<string, unknown>[] = [];
    const db = {
      query: {
        prepaidPackages: { findFirst: async () => ({ organizationId: ORG }) },
        users: {
          findFirst: async () => ({
            id: USER,
            email: "ejer@example.com",
            name: "Ejeren",
            prepaidAlertRecipient: over.prepaidAlertRecipient ?? "owner",
          }),
        },
        clients: {
          findFirst: async () => ({
            id: CLIENT,
            name: "Testkunde ApS",
            email: "kunde@example.com",
          }),
        },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push(values);
          },
        }),
      }),
    };
    return { db, updates };
  }

  const result = (over: Record<string, unknown> = {}) => ({
    remainingHours: 3,
    totalHours: 20,
    clientId: CLIENT,
    packageName: "Udviklingspakke 20 timer",
    lowBalanceAlertSentAt: null,
    usageId: "usage-row-1",
    hoursDeducted: 1,
    ...over,
  });

  it("sender til ejeren og markerer kortet, når saldoen er under tærsklen", async () => {
    const { db, updates } = alertDb();

    await checkAndSendLowBalanceAlert(db as never, USER, PACKAGE, result());

    expect(sendLowBalanceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ejer@example.com",
        recipient: "owner",
        remainingHours: "3.00",
        percentageRemaining: 15,
        portalUrl: null,
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].lowBalanceAlertSentAt).toBeInstanceOf(Date);
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "prepaid.low_balance" }),
    );
  });

  it("sender ikke når saldoen er over tærsklen", async () => {
    const { db, updates } = alertDb();

    await checkAndSendLowBalanceAlert(
      db as never,
      USER,
      PACKAGE,
      result({ remainingHours: 5 }),
    );

    expect(sendLowBalanceAlert).not.toHaveBeenCalled();
    expect(emitWebhookEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("sender ikke igen når kortet allerede har advaret", async () => {
    const { db } = alertDb();

    await checkAndSendLowBalanceAlert(
      db as never,
      USER,
      PACKAGE,
      result({ lowBalanceAlertSentAt: new Date("2026-01-01T00:00:00Z") }),
    );

    expect(sendLowBalanceAlert).not.toHaveBeenCalled();
  });

  it("sender kunden portal-linket, ikke dashboardet (#95)", async () => {
    const { db } = alertDb({ prepaidAlertRecipient: "both" });

    await checkAndSendLowBalanceAlert(db as never, USER, PACKAGE, result());

    expect(sendLowBalanceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ejer@example.com", portalUrl: null }),
    );
    expect(sendLowBalanceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "kunde@example.com",
        recipient: "client",
        portalUrl: "https://portal.example.com/abc",
      }),
    );
  });
});
