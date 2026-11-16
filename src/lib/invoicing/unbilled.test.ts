// src/lib/invoicing/unbilled.test.ts
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  approvedForInvoicingFilter,
  billableClientFilter,
  billableFlagFilter,
  isUnbilledEntry,
  notBilledFilter,
  notPrepaidFilter,
  type UnbilledEntryLike,
  unbilledEntryValue,
  unbilledScopeFilter,
  unbilledTimeEntryFilter,
} from "./unbilled";

/** En post der opfylder ALLE fem krav — testene varierer ét felt ad gangen. */
const mkEntry = (over: Partial<UnbilledEntryLike> = {}): UnbilledEntryLike => ({
  isBilled: false,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  ...over,
});

describe("isUnbilledEntry", () => {
  it("tæller en almindelig fakturerbar post med", () => {
    expect(isUnbilledEntry(mkEntry())).toBe(true);
  });

  it("udelader en post der allerede er faktureret", () => {
    expect(isUnbilledEntry(mkEntry({ isBilled: true }))).toBe(false);
  });

  it("udelader en post markeret som ikke-fakturerbar", () => {
    expect(isUnbilledEntry(mkEntry({ isBillable: false }))).toBe(false);
  });

  it("tæller isBillable = NULL med (rækker fra før kolonnens default)", () => {
    expect(isUnbilledEntry(mkEntry({ isBillable: null }))).toBe(true);
    expect(isUnbilledEntry(mkEntry({ isBillable: undefined }))).toBe(true);
  });

  it("udelader tid på en intern klient (defaultBillable = false)", () => {
    expect(isUnbilledEntry(mkEntry({ clientDefaultBillable: false }))).toBe(
      false,
    );
  });

  it("udelader en post uden kunde — intern tid kan ikke faktureres", () => {
    expect(isUnbilledEntry(mkEntry({ clientDefaultBillable: null }))).toBe(
      false,
    );
    expect(isUnbilledEntry(mkEntry({ clientDefaultBillable: undefined }))).toBe(
      false,
    );
  });

  describe("klippekort (isPrepaid)", () => {
    it("udelader klippekort-timer som standard — de er betalt forud", () => {
      expect(isUnbilledEntry(mkEntry({ isPrepaid: true }))).toBe(false);
    });

    it("medtager dem kun når kalderen beder eksplicit om det", () => {
      expect(
        isUnbilledEntry(mkEntry({ isPrepaid: true }), { includePrepaid: true }),
      ).toBe(true);
    });

    it("isPrepaid = NULL behandles som ikke-klippekort", () => {
      expect(isUnbilledEntry(mkEntry({ isPrepaid: null }))).toBe(true);
    });
  });

  describe("godkendelsesstatus", () => {
    it("udelader tid der afventer eller er afvist af en leder", () => {
      expect(isUnbilledEntry(mkEntry({ approvalStatus: "pending" }))).toBe(
        false,
      );
      expect(isUnbilledEntry(mkEntry({ approvalStatus: "rejected" }))).toBe(
        false,
      );
    });

    it("tæller godkendt og ikke-krævet tid med", () => {
      expect(isUnbilledEntry(mkEntry({ approvalStatus: "approved" }))).toBe(
        true,
      );
      expect(isUnbilledEntry(mkEntry({ approvalStatus: "not_required" }))).toBe(
        true,
      );
    });

    it("tæller NULL med — ingen workflow er ikke det samme som afvist", () => {
      expect(isUnbilledEntry(mkEntry({ approvalStatus: null }))).toBe(true);
      expect(isUnbilledEntry(mkEntry({ approvalStatus: undefined }))).toBe(
        true,
      );
    });

    it("tæller en ukendt status med — kun pending/rejected spærrer", () => {
      expect(isUnbilledEntry(mkEntry({ approvalStatus: "noget_nyt" }))).toBe(
        true,
      );
    });
  });
});

describe("unbilledEntryValue", () => {
  it("ganger timer med sats", () => {
    expect(unbilledEntryValue({ hours: "2.5", billableRate: "800" })).toBe(
      2000,
    );
  });

  it("giver 0 når satsen mangler — fakturalinjen ville også blive 0", () => {
    expect(unbilledEntryValue({ hours: "2.5", billableRate: null })).toBe(0);
  });

  it("giver 0 på uparsbare værdier i stedet for NaN", () => {
    expect(unbilledEntryValue({ hours: "abc", billableRate: "800" })).toBe(0);
  });
});

/** Den rå SQL en drizzle-betingelse bliver til. */
const dialect = new PgDialect();
const toSql = (condition: SQL): string => dialect.sqlToQuery(condition).sql;

describe("unbilledTimeEntryFilter", () => {
  const base = { userId: "u1" };

  it("scoper på organisationen når der er en, ellers på brugeren", () => {
    expect(toSql(unbilledScopeFilter(base))).toContain("user_id");
    expect(toSql(unbilledScopeFilter({ ...base, orgId: "o1" }))).toContain(
      "organization_id",
    );
  });

  it("begrænser til egne poster i org når onlyOwnEntries er sat", () => {
    const sql = toSql(
      unbilledScopeFilter({ ...base, orgId: "o1", onlyOwnEntries: true }),
    );
    expect(sql).toContain("organization_id");
    expect(sql).toContain("user_id");
  });

  it("indeholder alle fire led i den kanoniske definition", () => {
    const sql = toSql(unbilledTimeEntryFilter(base));
    expect(sql).toContain("is_billed");
    expect(sql).toContain("is_billable");
    expect(sql).toContain("is_prepaid");
    expect(sql).toContain("default_billable");
  });

  it("dropper is_prepaid-leddet når includePrepaid er sat", () => {
    const sql = toSql(
      unbilledTimeEntryFilter({ ...base, includePrepaid: true }),
    );
    expect(sql).not.toContain("is_prepaid");
    expect(sql).toContain("is_billed");
  });

  it("udelader scopingen når withoutScope er sat", () => {
    const sql = toSql(unbilledTimeEntryFilter({ ...base, withoutScope: true }));
    expect(sql).not.toContain("user_id");
    expect(sql).toContain("is_billed");
  });

  it("lægger periodegrænser på når from/to er givet", () => {
    const sql = toSql(
      unbilledTimeEntryFilter({
        ...base,
        from: new Date("2026-01-01"),
        to: new Date("2026-01-31"),
      }),
    );
    expect(sql).toContain("date");
  });
});

/**
 * NULL-kontrakten mellem SQL-prædikatet og JS-tvillingen.
 *
 * Det er HELE pointen med #626: to implementeringer af den samme regel må ikke
 * drifte fra hinanden. SQL er trevalueret — `NULL = false` og
 * `NULL NOT IN (…)` er begge NULL, altså falsk — hvor JS ville sige `true`.
 * Uden en `IS NULL`-gren i hvert led ville en NULL-række tælle med i widget'en
 * og falde ud af SQL-aggregeringen.
 *
 * Testen kan ikke køre rigtig SQL (ingen DB i vitest), så den holder de to
 * sider op mod hinanden strukturelt: for hvert felt hvor JS siger "NULL tæller
 * med" SKAL det tilsvarende SQL-led have en `IS NULL`-gren på samme kolonne.
 * Fjerner nogen grenen, fejler testen.
 */
describe("NULL-kontrakt mellem SQL og JS (#626)", () => {
  const nullTolerantFields: Array<{
    field: keyof UnbilledEntryLike;
    column: string;
    filter: () => SQL;
  }> = [
    { field: "isBilled", column: "is_billed", filter: notBilledFilter },
    { field: "isBillable", column: "is_billable", filter: billableFlagFilter },
    { field: "isPrepaid", column: "is_prepaid", filter: notPrepaidFilter },
    {
      field: "approvalStatus",
      column: "approval_status",
      filter: approvedForInvoicingFilter,
    },
  ];

  for (const { field, column, filter } of nullTolerantFields) {
    it(`${field}: NULL tæller med i BÅDE JS og SQL`, () => {
      // JS-siden
      expect(isUnbilledEntry(mkEntry({ [field]: null }))).toBe(true);
      // SQL-siden: leddet skal eksplicit acceptere NULL på samme kolonne
      const rendered = toSql(filter());
      expect(rendered).toContain(column);
      expect(rendered).toMatch(new RegExp(`"${column}"\\s+is null`, "i"));
    });

    it(`${field}: NULL-grenen er også med i det samlede prædikat`, () => {
      const rendered = toSql(unbilledTimeEntryFilter({ userId: "u1" }));
      expect(rendered).toMatch(new RegExp(`"${column}"\\s+is null`, "i"));
    });
  }

  it("clientDefaultBillable: ingen kunde falder ud i BÅDE JS og SQL", () => {
    // JS-siden: null = ingen kunde = ikke ufaktureret
    expect(isUnbilledEntry(mkEntry({ clientDefaultBillable: null }))).toBe(
      false,
    );
    // SQL-siden: EXISTS er falsk (ikke NULL) når COALESCE'en ikke rammer
    // nogen kunde, så en post uden kunde falder ud af sig selv.
    const rendered = toSql(billableClientFilter());
    expect(rendered).toContain("EXISTS");
    expect(rendered).toContain("default_billable");
  });
});

describe("billableFlagFilter / billableClientFilter", () => {
  it("accepterer isBillable både som true og NULL", () => {
    const sql = toSql(billableFlagFilter());
    expect(sql).toContain("is_billable");
    expect(sql.toLowerCase()).toContain("null");
  });

  it("kræver en kunde via COALESCE(entry, projekt) med default_billable", () => {
    const sql = toSql(billableClientFilter());
    expect(sql).toContain("default_billable");
    expect(sql).toContain("COALESCE");
    expect(sql).toContain("projects");
  });
});
