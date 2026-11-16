import { describe, expect, it } from "vitest";
import { tokenRefreshWindow } from "@/lib/cron/refresh-window";

// refresh-tokens kører hvert 5. minut. Tokens der snart udløber, fornyes
// hver gang. Allerede udløbne tokens (under et døgn gamle) prøves højst én
// gang i timen, så et dødt refresh-token ikke rammer Dinero 288 gange i døgnet.

const MIN = 60 * 1000;

describe("tokenRefreshWindow", () => {
  it("tager kun ikke-udløbne tokens med uden for timens første kørsel", () => {
    const now = new Date("2026-10-02T12:25:00.000Z");
    const w = tokenRefreshWindow(now);
    expect(w.from).toEqual(now);
    expect(w.to).toEqual(new Date(now.getTime() + 10 * MIN));
  });

  it("tager også tokens udløbet inden for et døgn med i timens første kørsel", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const w = tokenRefreshWindow(now);
    expect(w.from).toEqual(new Date(now.getTime() - 24 * 60 * MIN));
    expect(w.to).toEqual(new Date(now.getTime() + 10 * MIN));
  });

  it("regner en lidt forsinket kørsel (12:04) som timens første", () => {
    const now = new Date("2026-10-02T12:04:59.000Z");
    expect(tokenRefreshWindow(now).from).toEqual(
      new Date(now.getTime() - 24 * 60 * MIN),
    );
  });

  it("prøver aldrig tokens der har været udløbet i over et døgn", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const w = tokenRefreshWindow(now);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * MIN);
    expect(twoDaysAgo < w.from).toBe(true);
  });
});
