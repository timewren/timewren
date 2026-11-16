import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type CreditCandidate, planCredit } from "./lib";

const base: CreditCandidate = {
  orgId: "o1",
  aluntaSubscriptionId: "sub-1",
  billingCycle: "monthly",
  planTier: "solo",
  seatCount: 1,
  aluntaPlanId: null,
  discountPercent: 0,
  currentPeriodEnd: new Date("2026-12-15T00:00:00Z"),
};

const NOW = new Date("2026-11-08T00:00:00Z");

describe("planCredit", () => {
  it("månedlig: 100 % rabat fra periodeslutning og en måned frem", () => {
    const p = planCredit(base, 100, new Date("2026-11-08T00:00:00Z"));
    expect(p).toEqual({
      amount: 100,
      discount: {
        discount_name: "Founding: 1 måned gratis",
        discount_type: "percent",
        discount_value: 100,
        from_date: "2026-12-15",
        to_date: "2027-01-15",
      },
    });
  });

  it("årlig: springes over (manuel kreditnota)", () => {
    const p = planCredit({ ...base, billingCycle: "yearly" }, 83.33, NOW);
    expect("skip" in p).toBe(true);
  });

  it("forældet periodeslutning i fortiden springes over", () => {
    const p = planCredit(base, 100, new Date("2027-01-01T00:00:00Z"));
    expect("skip" in p).toBe(true);
  });

  it("beløbet tager højde for eksisterende rabat", () => {
    const p = planCredit({ ...base, discountPercent: 25 }, 100, NOW);
    if ("skip" in p) throw new Error("uventet skip");
    expect(p.amount).toBe(75);
  });

  it("månedsslut: 31. jan + 1 md bliver 28. feb, ikke 3. mar", () => {
    const p = planCredit(
      { ...base, currentPeriodEnd: new Date("2027-01-31T00:00:00Z") },
      100,
      NOW,
    );
    if ("skip" in p) throw new Error("uventet skip");
    expect(p.discount.to_date).toBe("2027-02-28");
  });

  it("uden periodeslutning springes over", () => {
    expect(planCredit({ ...base, currentPeriodEnd: null }, 100)).toEqual({
      skip: "mangler periodeslutning",
    });
  });
});

describe("credit-month --apply", () => {
  it("afvises uden CONFIRM_ALUNTA_WRITE=1, før noget læses eller skrives", () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: "postgres://invalid.invalid/x",
    };
    delete env.CONFIRM_ALUNTA_WRITE;
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/founding/credit-month.ts", "--apply"],
      { env: env as NodeJS.ProcessEnv, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("CONFIRM_ALUNTA_WRITE=1");
  });

  it("mark-founding kræver --before", () => {
    const r = spawnSync("npx", ["tsx", "scripts/founding/mark-founding.ts"], {
      env: { ...process.env, DATABASE_URL: "postgres://invalid.invalid/x" },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--before");
  });
});
