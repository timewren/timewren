import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_SEAT_PRICE_MONTHLY,
  PRIVAT_PRICE_MONTHLY,
  PRIVAT_PRICE_YEARLY,
  SUBSCRIPTION_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_YEARLY,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";
import {
  AFTER_TRIAL_SOLO,
  PAID_FROM_LINE,
  PLAN_PRICES,
  TRIAL_DAYS,
} from "./pricing-copy";

const SRC_DIR = join(process.cwd(), "src");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return listSourceFiles(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("pricing-copy", () => {
  it("læser alle planpriser fra billing-konstanterne", () => {
    expect(PLAN_PRICES.privat.price).toBe(`${PRIVAT_PRICE_MONTHLY} kr./md.`);
    expect(PLAN_PRICES.privat.extra).toBe(
      `eller ${PRIVAT_PRICE_YEARLY} kr./år`,
    );
    expect(PLAN_PRICES.selvstaendig.price).toBe(
      `${SUBSCRIPTION_PRICE_MONTHLY} kr./md.`,
    );
    expect(PLAN_PRICES.selvstaendig.extra).toBe(
      `eller ${SUBSCRIPTION_PRICE_YEARLY} kr./år`,
    );
    expect(PLAN_PRICES.team.price).toBe(
      `${TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger/md.`,
    );
    expect(PLAN_PRICES.virksomhed.price).toBe(
      `${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md.`,
    );
  });

  it("bygger 'betalt fra'-linjen på den billigste betalte plan", () => {
    expect(PAID_FROM_LINE).toBe(
      `Gratis at starte, betalt fra ${PLAN_PRICES.privat.amount}/md. ekskl. moms.`,
    );
  });

  it("siger det samme om prøven: 30 dage, intet kort, videre på Gratis", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(AFTER_TRIAL_SOLO).toContain("30 dage");
    expect(AFTER_TRIAL_SOLO).toContain("Gratis");
    expect(AFTER_TRIAL_SOLO).toContain("Intet betalingskort");
  });

  it("har ingen håndskrevne 'betalt fra'-linjer uden for pricing-copy.ts", () => {
    const offenders = listSourceFiles(SRC_DIR).filter(
      (file) =>
        !file.endsWith("pricing-copy.ts") &&
        !file.endsWith("pricing-copy.test.ts") &&
        /betalt\s+fra/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
