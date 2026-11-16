import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { WeekSummary } from "../WeekSummary";

describe("WeekSummary", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("da");
  });

  it("skriver ugedagene i det sprog, brugeren har valgt", async () => {
    // Ugedagene lå før som et dansk `FALLBACK_DAYS`-array bag syv nøgler der ikke
    // fandtes i nogen locale, så en svensk bruger fik danske dage i oversigten
    // og oversatte dage i kalenderen. De skal komme fra `calendar.dayHeaders`.
    await i18n.changeLanguage("en");
    render(<WeekSummary />);

    await waitFor(() => {
      const dayHeaders = i18n.t("calendar.dayHeaders", {
        returnObjects: true,
      }) as string[];
      for (const day of dayHeaders) {
        expect(screen.getByText(day)).toBeTruthy();
      }
    });
  });
});
