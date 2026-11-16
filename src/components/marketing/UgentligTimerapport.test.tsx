import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UgentligTimerapport } from "./UgentligTimerapport";

// Siden er statisk bygget: serverens HTML er fra build-dagen, klientens
// første render er fra besøgsdagen. Afhænger markuppen af dagens dato,
// fejler hydreringen med React #418 (fejlspor 57).
describe("UgentligTimerapport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function markupAt(iso: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    return renderToString(<UgentligTimerapport />).replace(
      /\b(?:data-)?(?:id|key)="[^"]*"/g,
      "",
    );
  }

  it("renders the same markup regardless of the current date", () => {
    // Fredag i uge 46 og søndagen bagefter (stadig ISO-uge 46).
    const friday = markupAt("2026-11-13T12:00:00");
    const sunday = markupAt("2026-11-15T12:00:00");
    const nextYear = markupAt("2027-03-01T12:00:00");
    expect(sunday).toBe(friday);
    expect(nextYear).toBe(friday);
  });
});
