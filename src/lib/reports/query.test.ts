// src/lib/reports/query.test.ts
import { describe, expect, it } from "vitest";
import { toLocalDateStr } from "@/lib/format";
import {
  reportTemplateConfigSchema,
  showsBudgetColumn,
} from "@/lib/reports/config-schema";
import type { ReportEntry } from "./columns";
import {
  aggregateReport,
  budgetMonthForRange,
  resolveDateRange,
} from "./query";

describe("resolveDateRange", () => {
  const ref = new Date(2026, 2, 15, 12, 0); // mid-March — use local constructor, not ISO

  it("resolves 'thisMonth' to 1st..last of March 2026", () => {
    const { start, end } = resolveDateRange(
      { dateRange: "thisMonth" } as never,
      ref,
    );
    expect(toLocalDateStr(start)).toBe("2026-03-01");
    expect(toLocalDateStr(end)).toBe("2026-03-31");
  });

  it("resolves 'lastMonth' to 1st..last of February 2026", () => {
    const { start, end } = resolveDateRange(
      { dateRange: "lastMonth" } as never,
      ref,
    );
    expect(toLocalDateStr(start)).toBe("2026-02-01");
    expect(toLocalDateStr(end)).toBe("2026-02-28");
  });

  it("resolves 'custom' to the given strings", () => {
    const { start, end } = resolveDateRange(
      {
        dateRange: "custom",
        customStart: "2026-01-01",
        customEnd: "2026-01-31",
      } as never,
      ref,
    );
    expect(toLocalDateStr(start)).toBe("2026-01-01");
    expect(toLocalDateStr(end)).toBe("2026-01-31");
  });

  const buildConfigWithCustomRange = (range: {
    customStart?: string;
    customEnd?: string;
  }) => ({
    audience: "internal",
    filters: {
      dateRange: "custom",
      ...range,
      clientIds: [],
      projectIds: [],
      memberIds: [],
      tagIds: [],
      billable: "all",
      billedStatus: "all",
      includePrepaid: true,
    },
    grouping: "none",
    sortBy: "date",
    sortDir: "desc",
    columns: ["date"],
    branding: {
      showLogo: false,
      primaryColor: "#3b82f6",
      title: "Intern tidsrapport",
      showSummaryCards: true,
      showClientBreakdown: false,
      showProjectBreakdown: false,
      showEntriesTable: true,
    },
    rounding: "useUserSetting",
  });

  it("rejects custom ranges without a start date at the config boundary", () => {
    const result = reportTemplateConfigSchema.safeParse(
      buildConfigWithCustomRange({ customEnd: "2026-01-31" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["filters", "customStart"]);
  });

  it("rejects custom ranges without an end date at the config boundary", () => {
    const result = reportTemplateConfigSchema.safeParse(
      buildConfigWithCustomRange({ customStart: "2026-01-01" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["filters", "customEnd"]);
  });
});

const mkEntry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  id: "e1",
  source: "manual",
  approvalStatus: null,
  segments: [],
  date: new Date("2026-03-15T12:00:00"),
  startTime: null,
  endTime: null,
  hours: "2.00",
  billableRate: "500",
  description: "",
  isBilled: false,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 2,
  _value: 1000,
  client: { id: "c1", name: "Acme" },
  project: { id: "p1", name: "Web", client: null, monthlyBudgetHours: null },
  prepaidPackage: null,
  tags: [],
  task: null,
  member: null,
  ...over,
});

describe("aggregateReport", () => {
  it("computes total hours/revenue/billed/unbilled", () => {
    const entries = [
      mkEntry({ hours: "2.0", _rounded: 2, _value: 1000 }),
      mkEntry({ hours: "3.0", _rounded: 3, _value: 1500, isBilled: true }),
    ];
    const agg = aggregateReport(entries, "none");
    expect(agg.summary.totalHours).toBeCloseTo(5);
    expect(agg.summary.totalRevenue).toBeCloseTo(2500);
    expect(agg.summary.billedHours).toBeCloseTo(3);
    expect(agg.summary.unbilledHours).toBeCloseTo(2);
    expect(agg.summary.entriesCount).toBe(2);
  });

  // #626: "ufaktureret" var før total − faktureret, så alt der ikke var
  // faktureret blev lovet som fakturerbart. Nu bruger summary'en den fælles
  // definition fra src/lib/invoicing/unbilled.ts.
  describe("ufaktureret følger den fælles definition (#626)", () => {
    it("tæller ikke intern tid (klient med defaultBillable=false) med", () => {
      const agg = aggregateReport(
        [mkEntry({ clientDefaultBillable: false, _rounded: 2, _value: 1000 })],
        "none",
      );
      expect(agg.summary.totalHours).toBeCloseTo(2);
      expect(agg.summary.unbilledHours).toBe(0);
      expect(agg.summary.unbilledRevenue).toBe(0);
    });

    it("tæller ikke tid uden kunde med", () => {
      const agg = aggregateReport(
        [
          mkEntry({
            client: null,
            project: null,
            clientDefaultBillable: null,
            _rounded: 2,
            _value: 1000,
          }),
        ],
        "none",
      );
      expect(agg.summary.unbilledHours).toBe(0);
    });

    it("tæller ikke eksplicit ikke-fakturerbar tid med", () => {
      const agg = aggregateReport([mkEntry({ isBillable: false })], "none");
      expect(agg.summary.unbilledHours).toBe(0);
    });

    it("tæller isBillable = NULL med (gamle rækker)", () => {
      const agg = aggregateReport(
        [mkEntry({ isBillable: null, _rounded: 2 })],
        "none",
      );
      expect(agg.summary.unbilledHours).toBeCloseTo(2);
    });

    it("tæller ikke klippekort-timer med — de er betalt forud", () => {
      const agg = aggregateReport(
        [mkEntry({ isPrepaid: true, _rounded: 2, _value: 1000 })],
        "none",
      );
      expect(agg.summary.totalHours).toBeCloseTo(2);
      expect(agg.summary.unbilledHours).toBe(0);
    });

    it("tæller ikke tid der afventer eller er afvist af en leder med", () => {
      for (const approvalStatus of ["pending", "rejected"]) {
        const agg = aggregateReport([mkEntry({ approvalStatus })], "none");
        expect(agg.summary.unbilledHours).toBe(0);
      }
    });

    it("summen faktureret + ufaktureret kan være mindre end totalen", () => {
      const agg = aggregateReport(
        [
          mkEntry({ _rounded: 2, _value: 1000 }),
          mkEntry({ isBilled: true, _rounded: 3, _value: 1500 }),
          // Intern tid: hverken faktureret eller ufaktureret
          mkEntry({
            clientDefaultBillable: false,
            _rounded: 5,
            _value: 2500,
          }),
        ],
        "none",
      );
      expect(agg.summary.totalHours).toBeCloseTo(10);
      expect(agg.summary.billedHours).toBeCloseTo(3);
      expect(agg.summary.unbilledHours).toBeCloseTo(2);
    });
  });

  it("groups by client when grouping='client'", () => {
    const entries = [
      mkEntry({
        client: { id: "c1", name: "Acme" },
        hours: "2.0",
        _rounded: 2,
      }),
      mkEntry({
        client: { id: "c2", name: "Beta" },
        hours: "3.0",
        _rounded: 3,
      }),
      mkEntry({
        client: { id: "c1", name: "Acme" },
        hours: "1.5",
        _rounded: 1.5,
      }),
    ];
    const agg = aggregateReport(entries, "client");
    expect(agg.groups).toHaveLength(2);
    const acme = agg.groups.find((g) => g.key === "c1");
    expect(acme?.hours).toBeCloseTo(3.5);
  });

  it("uses _rounded (not raw hours) when rounding is applied", () => {
    const entries = [
      mkEntry({ hours: "2.17", _rounded: 2.25, _value: 1125 }),
      mkEntry({ hours: "1.33", _rounded: 1.5, _value: 750 }),
    ];
    const agg = aggregateReport(entries, "none");
    // Totals must reflect rounded values (2.25 + 1.5 = 3.75), not raw (2.17 + 1.33 = 3.50)
    expect(agg.summary.totalHours).toBeCloseTo(3.75);
    expect(agg.summary.totalRevenue).toBeCloseTo(1875);
  });
});

// ─── Kunde + projekt (#593) ──────────────────────────────────────────────────

describe("aggregateReport — clientProject", () => {
  const acmeWeb = {
    id: "p1",
    name: "Web",
    client: null,
    monthlyBudgetHours: null,
  };
  const betaWeb = {
    id: "p2",
    name: "Web",
    client: null,
    monthlyBudgetHours: null,
  };

  it("holder to projekter med samme navn adskilt pr. kunde", () => {
    const entries = [
      mkEntry({
        client: { id: "c1", name: "Acme" },
        project: acmeWeb,
        _rounded: 2,
      }),
      mkEntry({
        client: { id: "c2", name: "Beta" },
        project: betaWeb,
        _rounded: 3,
      }),
      mkEntry({
        client: { id: "c1", name: "Acme" },
        project: acmeWeb,
        _rounded: 1,
      }),
    ];
    const agg = aggregateReport(entries, "clientProject");
    expect(agg.groups).toHaveLength(2);
    const acme = agg.groups.find((g) => g.key === "c1:p1");
    expect(acme?.label).toBe("Acme — Web");
    expect(acme?.hours).toBeCloseTo(3);
    expect(agg.groups.find((g) => g.key === "c2:p2")?.label).toBe("Beta — Web");
  });

  it("falder tilbage til projektets kunde når posten ikke har en", () => {
    const agg = aggregateReport(
      [
        mkEntry({
          client: null,
          project: {
            id: "p1",
            name: "Web",
            client: { id: "c9", name: "Gamma" },
            monthlyBudgetHours: null,
          },
        }),
      ],
      "clientProject",
    );
    expect(agg.groups[0]?.key).toBe("c9:p1");
    expect(agg.groups[0]?.label).toBe("Gamma — Web");
  });

  it("navngiver manglende kunde og projekt", () => {
    const agg = aggregateReport(
      [mkEntry({ client: null, project: null })],
      "clientProject",
    );
    expect(agg.groups[0]?.label).toBe("(Ingen kunde) — (Intet projekt)");
  });

  it("har ingen note", () => {
    expect(
      aggregateReport([mkEntry()], "clientProject").groupingNote,
    ).toBeNull();
  });
});

// ─── Tag (#593) ──────────────────────────────────────────────────────────────

describe("aggregateReport — tag", () => {
  it("tæller en post med to tags i begge grupper", () => {
    const entries = [
      mkEntry({
        _rounded: 2,
        _value: 1000,
        tags: [
          { id: "t1", name: "SEO" },
          { id: "t2", name: "Ads" },
        ],
      }),
    ];
    const agg = aggregateReport(entries, "tag");
    expect(agg.groups).toHaveLength(2);
    expect(agg.groups.find((g) => g.key === "t1")?.hours).toBeCloseTo(2);
    expect(agg.groups.find((g) => g.key === "t2")?.hours).toBeCloseTo(2);
    // Summen af grupperne overstiger totalen — det er meningen
    const groupSum = agg.groups.reduce((s, g) => s + g.hours, 0);
    expect(groupSum).toBeCloseTo(4);
    expect(agg.summary.totalHours).toBeCloseTo(2);
  });

  it("samler poster uden tag under 'Uden tag'", () => {
    const agg = aggregateReport(
      [
        mkEntry({ _rounded: 2, tags: [] }),
        mkEntry({ _rounded: 1, tags: [] }),
        mkEntry({ _rounded: 4, tags: [{ id: "t1", name: "SEO" }] }),
      ],
      "tag",
    );
    const none = agg.groups.find((g) => g.key === "_none");
    expect(none?.label).toBe("Uden tag");
    expect(none?.hours).toBeCloseTo(3);
    expect(agg.groups.find((g) => g.key === "t1")?.hours).toBeCloseTo(4);
  });

  it("viser noten om dobbelttælling", () => {
    const agg = aggregateReport([mkEntry()], "tag");
    expect(agg.groupingNote).toContain("summen kan overstige totalen");
  });
});

// ─── Budget-kolonne (#593) ───────────────────────────────────────────────────

describe("aggregateReport — budget", () => {
  const budgeted = {
    id: "p1",
    name: "Testkunde ApS",
    client: null,
    monthlyBudgetHours: 50,
  };

  const usage = (hours: number) => new Map([["p1", hours]]);
  const opts = (hours: number) => ({
    budgetUsageByProject: usage(hours),
    budgetMonth: "2026-03",
  });

  it("måler månedens SAMLEDE forbrug mod månedsbudgettet", () => {
    const agg = aggregateReport(
      [mkEntry({ project: budgeted, _rounded: 2 })],
      "project",
      opts(17),
    );
    // 17 er månedens fulde forbrug fra DB — ikke gruppens 2 filtrerede timer
    expect(agg.groups[0]?.budget).toEqual({
      budgetHours: 50,
      usedHours: 17,
      percentage: 34,
      healthStatus: "green",
      month: "2026-03",
    });
  });

  it("er uafhængig af rapportens filtre", () => {
    // Samme projekt, to forskellige rapport-udsnit → samme budget-tal
    const a = aggregateReport(
      [mkEntry({ project: budgeted, _rounded: 1 })],
      "project",
      opts(45),
    );
    const b = aggregateReport(
      [
        mkEntry({ project: budgeted, _rounded: 20 }),
        mkEntry({ project: budgeted, _rounded: 25 }),
      ],
      "project",
      opts(45),
    );
    expect(a.groups[0]?.budget?.percentage).toBe(90);
    expect(b.groups[0]?.budget?.percentage).toBe(90);
  });

  it("virker også ved kunde+projekt-gruppering", () => {
    const agg = aggregateReport(
      [mkEntry({ project: budgeted, _rounded: 1 })],
      "clientProject",
      opts(55),
    );
    expect(agg.groups[0]?.budget?.percentage).toBe(110);
    expect(agg.groups[0]?.budget?.healthStatus).toBe("red");
  });

  it("er null uden forbrugs-map — fx når perioden spænder over flere måneder", () => {
    const agg = aggregateReport(
      [mkEntry({ project: budgeted, _rounded: 17 })],
      "project",
    );
    expect(agg.groups[0]?.budget).toBeNull();
  });

  it("er null uden månedsbudget og ved andre grupperinger", () => {
    expect(
      aggregateReport([mkEntry({ project: budgeted })], "client", opts(17))
        .groups[0]?.budget,
    ).toBeNull();
    expect(
      aggregateReport([mkEntry()], "project", opts(17)).groups[0]?.budget,
    ).toBeNull();
  });
});

describe("budgetMonthForRange", () => {
  it("giver månedsnøglen når hele perioden ligger i én måned", () => {
    expect(
      budgetMonthForRange(new Date(2026, 2, 1), new Date(2026, 2, 31)),
    ).toBe("2026-03");
  });

  it("giver null når perioden rører to måneder", () => {
    // "sidste 30 dage": 15/1-13/2 — at gange budgettet med 2 ville gøre et
    // rødt projekt grønt, så kolonnen skal skjules i stedet
    expect(
      budgetMonthForRange(new Date(2026, 0, 15), new Date(2026, 1, 13)),
    ).toBeNull();
  });

  it("giver null over et årsskifte", () => {
    expect(
      budgetMonthForRange(new Date(2025, 11, 1), new Date(2026, 0, 31)),
    ).toBeNull();
  });
});

describe("showsBudgetColumn", () => {
  const cfg = (over: Partial<{ columns: string[]; grouping: string }>) =>
    ({
      columns: ["date"],
      grouping: "none",
      ...over,
    }) as never;

  it("kræver både kolonnen og en projekt-gruppering", () => {
    expect(
      showsBudgetColumn(cfg({ columns: ["budget"], grouping: "project" })),
    ).toBe(true);
    expect(
      showsBudgetColumn(
        cfg({ columns: ["budget"], grouping: "clientProject" }),
      ),
    ).toBe(true);
  });

  it("er falsk uden kolonnen eller med en anden gruppering", () => {
    expect(showsBudgetColumn(cfg({ grouping: "project" }))).toBe(false);
    expect(
      showsBudgetColumn(cfg({ columns: ["budget"], grouping: "tag" })),
    ).toBe(false);
    expect(
      showsBudgetColumn(cfg({ columns: ["budget"], grouping: "none" })),
    ).toBe(false);
  });
});
