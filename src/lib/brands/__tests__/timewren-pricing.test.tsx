import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-gate";
import {
  BUSINESS_INCLUDED_SEATS,
  BUSINESS_MAX_SEATS,
  BUSINESS_SEAT_PRICE_MONTHLY,
  PRIVAT_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_INCLUDED_SEATS,
  TEAM_MAX_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";
import { timewrenPlans } from "../timewren-pricing";

vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "display" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/billing/plan-gate");
  vi.doUnmock("@/lib/config");
  vi.resetModules();
});

async function renderPricing(locale: string) {
  const mod = await import(
    "@/app/(timewren)/timewren-site/[locale]/pricing/page"
  );
  const el = await mod.default({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(el);
}

/** Teksten i en plans række (navn, priser, brugere, kunder). */
function planRow(html: string, tier: string) {
  const m = html.match(new RegExp(`<li data-plan="${tier}">(.*?)</li>`));
  return (m?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("TimeWren Cloud-priser: konfigurationen", () => {
  it("samme fem planer som TimeTrack, DKK og grænser fra billing-koden", () => {
    expect(timewrenPlans()).toEqual([
      {
        tier: "free",
        monthly: { EUR: 0, USD: 0, DKK: 0 },
        perUser: false,
        minUsers: 1,
        maxUsers: FREE_MAX_SEATS,
        maxActiveClients: FREE_MAX_ACTIVE_CLIENTS,
      },
      {
        tier: "privat",
        monthly: { EUR: 4, USD: 4, DKK: PRIVAT_PRICE_MONTHLY },
        perUser: false,
        minUsers: 1,
        maxUsers: 1,
        maxActiveClients: PRIVAT_MAX_ACTIVE_CLIENTS,
      },
      {
        tier: "solo",
        monthly: { EUR: 11, USD: 12, DKK: SUBSCRIPTION_PRICE_MONTHLY },
        perUser: false,
        minUsers: 1,
        maxUsers: 1,
        maxActiveClients: null,
      },
      {
        tier: "team",
        monthly: { EUR: 7, USD: 8, DKK: TEAM_SEAT_PRICE_MONTHLY },
        perUser: true,
        minUsers: TEAM_INCLUDED_SEATS,
        maxUsers: TEAM_MAX_SEATS,
        maxActiveClients: null,
      },
      {
        tier: "business",
        monthly: { EUR: 9, USD: 10, DKK: BUSINESS_SEAT_PRICE_MONTHLY },
        perUser: true,
        minUsers: BUSINESS_INCLUDED_SEATS,
        maxUsers: BUSINESS_MAX_SEATS,
        maxActiveClients: null,
      },
    ]);
  });

  it("de besluttede tal (8/11-2026) står i billing-koden", () => {
    // Fejler, hvis TimeTracks priser eller grænser ændres: så skal EUR/USD
    // i timewren-pricing.ts tages op samtidig.
    expect([
      PRIVAT_PRICE_MONTHLY,
      SUBSCRIPTION_PRICE_MONTHLY,
      TEAM_SEAT_PRICE_MONTHLY,
      BUSINESS_SEAT_PRICE_MONTHLY,
    ]).toEqual([29, 79, 49, 69]);
    expect([
      FREE_MAX_SEATS,
      FREE_MAX_ACTIVE_CLIENTS,
      PRIVAT_MAX_ACTIVE_CLIENTS,
    ]).toEqual([3, 3, 10]);
  });
});

describe("TimeWren Cloud-priser: prissiden", () => {
  it("en: EUR valgt fra start, alle tre valutaer i HTML'en", async () => {
    const html = await renderPricing("en");
    expect(html).toMatch(/id="currency-EUR"[^>]*checked=""/);
    expect(html).not.toMatch(/id="currency-(USD|DKK)"[^>]*checked=""/);
    expect(planRow(html, "privat")).toBe(
      " Privat €4 $4 DKK 29 per month 1 user. Up to 10 active clients. ",
    );
    expect(planRow(html, "solo")).toContain("€11 $12 DKK 79 per month");
    expect(planRow(html, "solo")).toContain("Unlimited active clients");
    expect(planRow(html, "team")).toContain("€7 $8 DKK 49 per user per month");
    expect(planRow(html, "team")).toContain("2 to 25 users");
    expect(planRow(html, "business")).toContain("€9 $10 DKK 69");
    expect(planRow(html, "business")).toContain("5 to 50 users");
    expect(planRow(html, "free")).toContain(
      "€0 $0 DKK 0 per month Up to 3 users. Up to 3 active clients.",
    );
    expect(html).toContain("All prices exclude VAT.");
    expect(html).toContain(
      '<span class="billed-dkk">Prices in EUR and USD are billed in DKK until local billing launches.</span>',
    );
    expect(html).toContain('href="https://timewren.com/register"');
    expect(html).not.toContain("Coming soon");
  });

  it("da: DKK valgt fra start og danske tal", async () => {
    const html = await renderPricing("da");
    expect(html).toMatch(/id="currency-DKK"[^>]*checked=""/);
    expect(planRow(html, "solo")).toMatch(/79\skr\./);
    expect(planRow(html, "privat")).toContain("Op til 10 aktive kunder");
    expect(html).toContain("Alle priser er ekskl. moms.");
  });

  it.each(["de", "es"])("%s: EUR valgt fra start", async (l) => {
    const html = await renderPricing(l);
    expect(html).toMatch(/id="currency-EUR"[^>]*checked=""/);
  });

  it("grænser og DKK-priser læses fra billing-koden, ikke fra siden", async () => {
    vi.resetModules();
    vi.doMock("@/lib/billing/plan-gate", async (orig) => ({
      ...(await orig<object>()),
      PRIVAT_MAX_ACTIVE_CLIENTS: 7,
      FREE_MAX_SEATS: 4,
    }));
    vi.doMock("@/lib/config", async (orig) => ({
      ...(await orig<object>()),
      SUBSCRIPTION_PRICE_MONTHLY: 81,
    }));
    const html = await renderPricing("en");
    expect(planRow(html, "privat")).toContain("Up to 7 active clients");
    expect(planRow(html, "free")).toContain("Up to 4 users");
    expect(planRow(html, "solo")).toContain("DKK 81");
  });

  it("valutavælgeren virker uden JS: CSS skjuler de andre valutaer", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/(timewren)/timewren-site/[locale]/site.css"),
      "utf8",
    ).replace(/\s+/g, " ");
    for (const c of ["EUR", "USD", "DKK"]) {
      expect(css).toContain(
        `.plan.cloud:has(#currency-${c}:checked) [data-currency]:not([data-currency="${c}"])`,
      );
    }
    // DKK-noten om fakturering vises kun for EUR og USD.
    expect(css).toContain(".plan.cloud:has(#currency-DKK:checked) .billed-dkk");
  });

  it("siden er statisk (ISR) og har ingen klientkomponenter", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/(timewren)/timewren-site/[locale]/pricing/page.tsx",
      ),
      "utf8",
    );
    expect(src).toMatch(/export const revalidate = \d+/);
    expect(src).not.toMatch(/"use client"|searchParams|cookies\(|headers\(/);
  });
});
