import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARBEJDSDAGE_YEARS,
  adjacentMonth,
  arbejdsdageHubPaths,
  arbejdsdageHubSections,
  arbejdsdageMonthMeta,
  arbejdsdageYearMeta,
  arbejdstimerYearMeta,
  dayRowsForMonth,
  monthFromSlug,
  monthSlug,
  seoPagePaths,
} from "./arbejdsdage-seo";
import { officialHolidays, workdaysByMonth } from "./workdays";

describe("helligdage 2025-2028 mod kendte datoer", () => {
  const dates = (y: number) => officialHolidays(y).map((h) => h.date);

  it("2025 (påske 20. april)", () => {
    expect(dates(2025)).toEqual([
      "2025-01-01",
      "2025-04-17",
      "2025-04-18",
      "2025-04-20",
      "2025-04-21",
      "2025-05-29",
      "2025-06-08",
      "2025-06-09",
      "2025-12-25",
      "2025-12-26",
    ]);
  });

  it("2026 (påske 5. april)", () => {
    expect(dates(2026)).toEqual([
      "2026-01-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-05",
      "2026-04-06",
      "2026-05-14",
      "2026-05-24",
      "2026-05-25",
      "2026-12-25",
      "2026-12-26",
    ]);
  });

  it("2027 (påske 28. marts)", () => {
    expect(dates(2027)).toEqual([
      "2027-01-01",
      "2027-03-25",
      "2027-03-26",
      "2027-03-28",
      "2027-03-29",
      "2027-05-06",
      "2027-05-16",
      "2027-05-17",
      "2027-12-25",
      "2027-12-26",
    ]);
  });

  it("2028 (påske 16. april)", () => {
    expect(dates(2028)).toEqual([
      "2028-01-01",
      "2028-04-13",
      "2028-04-14",
      "2028-04-16",
      "2028-04-17",
      "2028-05-25",
      "2028-06-04",
      "2028-06-05",
      "2028-12-25",
      "2028-12-26",
    ]);
  });
});

describe("arbejdsdage pr. måned 2026 mod håndregnet tabel", () => {
  it("matcher tabellen", () => {
    expect(workdaysByMonth(2026).map((m) => m.workdays)).toEqual([
      21, 20, 22, 19, 19, 22, 23, 21, 22, 22, 21, 22,
    ]);
  });
});

describe("årsvindue og slugs", () => {
  it("dækker indeværende år ±2 (2024-2028)", () => {
    expect([...ARBEJDSDAGE_YEARS]).toEqual([2024, 2025, 2026, 2027, 2028]);
  });

  it("månedsslugs er danske og kan slås op igen", () => {
    expect(monthSlug(0)).toBe("januar");
    expect(monthSlug(9)).toBe("oktober");
    for (let m = 0; m < 12; m++) expect(monthFromSlug(monthSlug(m))).toBe(m);
    expect(monthFromSlug("oktober2")).toBeNull();
  });

  it("alle sider findes som route-filer", () => {
    const root = join(__dirname, "../../app/(marketing)");
    for (const y of ARBEJDSDAGE_YEARS) {
      expect(existsSync(join(root, `arbejdsdage-${y}/page.tsx`))).toBe(true);
      expect(existsSync(join(root, `arbejdsdage-${y}/[maaned]/page.tsx`))).toBe(
        true,
      );
      expect(existsSync(join(root, `arbejdstimer-${y}/page.tsx`))).toBe(true);
    }
    expect(existsSync(join(root, "arbejdsdage/page.tsx"))).toBe(true);
  });
});

describe("sidelister", () => {
  const paths = seoPagePaths();

  it("indeholder 5 år, 60 måneder, 5 timeår og hubben", () => {
    expect(paths).toHaveLength(5 + 60 + 5 + 1);
    expect(paths).toContain("/arbejdsdage");
    expect(paths).toContain("/arbejdsdage-2026");
    expect(paths).toContain("/arbejdsdage-2026/oktober");
    expect(paths).toContain("/arbejdstimer-2028");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("hubben linker til alle år og måneder", () => {
    const hub = arbejdsdageHubSections().flatMap((s) => [
      s.yearHref,
      s.hoursHref,
      ...s.months.map((m) => m.href),
    ]);
    expect(hub).toEqual(arbejdsdageHubPaths());
    for (const p of paths.filter((x) => x !== "/arbejdsdage")) {
      expect(hub).toContain(p);
    }
  });
});

describe("titler og meta", () => {
  const all = [
    ...ARBEJDSDAGE_YEARS.map((y) => arbejdsdageYearMeta(y)),
    ...ARBEJDSDAGE_YEARS.flatMap((y) =>
      Array.from({ length: 12 }, (_, m) => arbejdsdageMonthMeta(y, m)),
    ),
    ...ARBEJDSDAGE_YEARS.map((y) => arbejdstimerYearMeta(y)),
  ];

  it("har unikke titler, beskrivelser og canonicals", () => {
    expect(new Set(all.map((m) => m.title)).size).toBe(all.length);
    expect(new Set(all.map((m) => m.description)).size).toBe(all.length);
    expect(new Set(all.map((m) => m.path)).size).toBe(all.length);
  });

  it("har tallet i titlen", () => {
    expect(arbejdsdageYearMeta(2026).title).toBe(
      "Arbejdsdage 2026: 254 dage (1.879,6 timer ved 37 t/uge)",
    );
    expect(arbejdsdageMonthMeta(2026, 9).title).toBe(
      "Arbejdsdage oktober 2026: 22 dage (162,8 timer ved 37 t/uge)",
    );
    expect(arbejdstimerYearMeta(2026).title).toBe(
      "Arbejdstimer 2026: 1.879,6 timer ved 37 t/uge (254 arbejdsdage)",
    );
  });

  it("holder den renderede titel (med suffiks) under 80 tegn", () => {
    for (const m of all)
      expect(`${m.title} | TimeTrack`.length).toBeLessThan(80);
  });
});

describe("dayRowsForMonth", () => {
  it("klassificerer dagene i december 2026", () => {
    const rows = dayRowsForMonth(2026, 11);
    expect(rows).toHaveLength(31);
    expect(rows[23]).toMatchObject({ date: "2026-12-24", kind: "valgfri" });
    expect(rows[24]).toMatchObject({ date: "2026-12-25", kind: "helligdag" });
    expect(rows[25]).toMatchObject({ date: "2026-12-26", kind: "weekend" });
    expect(rows.filter((r) => r.kind === "arbejdsdag")).toHaveLength(20);
  });
});

describe("månedsbeskrivelse", () => {
  it("tæller kun helligdage på hverdage", () => {
    expect(arbejdsdageMonthMeta(2026, 3).description).toContain(
      "3 helligdage på hverdage (skærtorsdag, langfredag, 2. påskedag",
    );
    expect(arbejdsdageMonthMeta(2026, 4).description).toContain(
      "2 helligdage på hverdage",
    );
  });
});

describe("adjacentMonth", () => {
  it("går over årsskiftet inden for vinduet", () => {
    expect(adjacentMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(adjacentMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(adjacentMonth(2024, 0, -1)).toBeNull();
    expect(adjacentMonth(2028, 11, 1)).toBeNull();
  });
});
