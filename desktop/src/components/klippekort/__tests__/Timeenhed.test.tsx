import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatHours } from "@/lib/format";
import i18n from "@/lib/i18n";
import type { Klippekort } from "@/lib/types";

/**
 * K25d. Timeenheden stod i *kodeteksten* som `t` og som det danske ord `timer` —
 * altså to forskellige hårdkodede former for det samme. K25f lod `timer` stå
 * med en note om at `Intl` ikke kan løse det, men det kan den slet ikke: her
 * skal der ikke være en valuta, kun en enhed, og den har en oversat nøgle i alle
 * fem sprog (`common.hours`: timer / hours / timmar / timer / Stunden).
 *
 * Konsekvensen var reel: en tysk bruger læste «6 / 20 timer» og «2,5t übrig»,
 * hvor `timer` på tysk er en **køkkenurt** (Timekeeper), og `t` overhovedet ikke
 * betyder time. Det er samme fejlklasse som review-fundet om tidssatser: tallet
 * følger nu sprogvalget, og enheden gør det også.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "get_over_budget_projects")
      return [
        {
          id: "p1",
          name: "Udvikling",
          estimated_hours: 5,
          used_hours: 8,
          percentage: 160,
        },
      ];
    return null;
  },
}));

const SPROG = ["da", "en", "sv", "nb", "de"] as const;

/** Det ord hvert sprog faktisk bruger — læst fra json'en, ikke gjættet. */
const timeord = async (lang: (typeof SPROG)[number]) =>
  (await import(`@/locales/${lang}.json`)).default.common.hours as string;

const klippekort = {
  id: "k1",
  client_id: "c1",
  client_name: "Kunde A",
  name: "Udvikling",
  total_hours: 20,
  used_hours: 6,
  hourly_rate: 850,
  is_active: 1,
  created_at: "2026-01-01T00:00:00",
} as unknown as Klippekort;

afterEach(cleanup);

describe("timeenheden følger sprogvalget", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("da");
  });

  it("klippekortkortet skriver «timer» i dansk og sit eget ord i de fire andre", async () => {
    for (const lang of SPROG) {
      await i18n.changeLanguage(lang);
      const { KlippekortCard } = await import(
        "@/components/klippekort/KlippekortCard"
      );
      const { unmount } = render(
        <KlippekortCard klippekort={klippekort} onClick={() => {}} />,
      );
      const tekst = document.body.textContent ?? "";
      const ord = await timeord(lang);

      expect(
        tekst,
        `${lang}: «6 / 20 timer» skal læses med sprogets timeord`,
      ).toContain(`${formatHours(6)} / ${formatHours(20)} ${ord}`);
      expect(tekst, `${lang}: resten skal have enheden`).toContain(
        `${formatHours(14)} ${ord}`,
      );
      // `timer` på tysk/norsk er ikke «time» i denne sammenhæng, så den
      // danske form må ikke overleve i et andet sprog.
      if (lang !== "da" && lang !== "nb") {
        expect(
          tekst,
          `${lang}: dansk «timer» står stadig i markup'en`,
        ).not.toContain("timer");
      }
      unmount();
    }
  });

  it("dashboardet skriver «2,5 t»-formen med enheden i hvert sprog", async () => {
    for (const lang of SPROG) {
      await i18n.changeLanguage(lang);
      const { OverBudgetProjects } = await import(
        "@/components/dashboard/OverBudgetProjects"
      );
      const { unmount } = render(<OverBudgetProjects />);
      const ord = await timeord(lang);
      await waitFor(() =>
        expect(document.body.textContent ?? "").toContain("Udvikling"),
      );
      const tekst = document.body.textContent ?? "";

      expect(tekst, `${lang}: «8 timer / 5 timer»`).toContain(
        `8 ${ord} / 5 ${ord}`,
      );
      unmount();
    }
  });
});
