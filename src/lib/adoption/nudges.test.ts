import { describe, expect, it } from "vitest";
import {
  daysBetween,
  evaluateInvoiceNudge,
  INVOICE_NUDGE_MIN_DAYS,
  INVOICE_NUDGE_MIN_HOURS,
  isNudgeDismissed,
  lookbackMonths,
  nicePackageHours,
  nudgeDismissKey,
  suggestPrepaidPackage,
} from "./nudges";

const CLIENT = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";

const base = {
  clientId: CLIENT,
  clientName: "Kunde A",
  hours: 20,
  value: 16000,
  oldestUnbilledDate: "2026-08-01",
  lastInvoiceDate: null,
};

describe("evaluateInvoiceNudge", () => {
  it("nudger når der er nok timer og lang nok tid siden ældste post", () => {
    const nudge = evaluateInvoiceNudge(base, "2026-10-02");
    expect(nudge).not.toBeNull();
    expect(nudge?.since).toBe("oldest_entry");
    expect(nudge?.daysSince).toBe(62);
  });

  it("måler fra sidste faktura når kunden er faktureret før", () => {
    const nudge = evaluateInvoiceNudge(
      { ...base, lastInvoiceDate: "2026-08-20" },
      "2026-10-02",
    );
    expect(nudge?.since).toBe("last_invoice");
    expect(nudge?.daysSince).toBe(43);
  });

  it("tier under timetærsklen", () => {
    expect(
      evaluateInvoiceNudge(
        { ...base, hours: INVOICE_NUDGE_MIN_HOURS - 0.1 },
        "2026-10-02",
      ),
    ).toBeNull();
    expect(
      evaluateInvoiceNudge(
        { ...base, hours: INVOICE_NUDGE_MIN_HOURS },
        "2026-10-02",
      ),
    ).not.toBeNull();
  });

  it("tier når der netop er faktureret", () => {
    expect(
      evaluateInvoiceNudge(
        { ...base, lastInvoiceDate: "2026-09-20" },
        "2026-10-02",
      ),
    ).toBeNull();
  });

  it("grænsen er inklusiv på dage", () => {
    const today = "2026-10-02";
    const exactly = new Date(
      Date.UTC(2026, 9, 2) - INVOICE_NUDGE_MIN_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(
      evaluateInvoiceNudge({ ...base, oldestUnbilledDate: exactly }, today),
    ).not.toBeNull();
  });

  it("nudger også uden sats (0 kr) — manglende sats er i sig selv værd at se", () => {
    expect(
      evaluateInvoiceNudge({ ...base, value: 0 }, "2026-10-02"),
    ).not.toBeNull();
  });

  it("afviser ugyldige datoer i stedet for at regne NaN", () => {
    expect(
      evaluateInvoiceNudge({ ...base, oldestUnbilledDate: "" }, "2026-10-02"),
    ).toBeNull();
  });
});

describe("daysBetween", () => {
  it("tæller hele kalenderdage hen over sommertidsskift", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("lookbackMonths", () => {
  it("giver de tre hele måneder før dagens måned", () => {
    expect(lookbackMonths("2026-10-02")).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("krydser årsskiftet", () => {
    expect(lookbackMonths("2027-02-15")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });
});

describe("nicePackageHours", () => {
  it("runder op til nærmeste standardpakke", () => {
    expect(nicePackageHours(3)).toBe(5);
    expect(nicePackageHours(10)).toBe(10);
    expect(nicePackageHours(10.5)).toBe(15);
    expect(nicePackageHours(33)).toBe(40);
  });

  it("lofter ved største pakke", () => {
    expect(nicePackageHours(500)).toBe(100);
  });
});

describe("suggestPrepaidPackage", () => {
  const months = ["2026-07", "2026-08", "2026-09"];

  it("foreslår ca. et kvartals forbrug med historisk sats", () => {
    const s = suggestPrepaidPackage(
      [
        { month: "2026-07", hours: 3, value: 2400 },
        { month: "2026-08", hours: 4, value: 3200 },
        { month: "2026-09", hours: 5, value: 4000 },
      ],
      months,
    );
    // snit 4 t/md → 12 t/kvartal → 15-timers pakke à 800 kr
    expect(s).toEqual({
      hours: 15,
      hourlyRate: 800,
      totalPrice: 12000,
      avgMonthlyHours: 4,
      monthsCovered: 3.8,
    });
  });

  it("kræver tid i HVER måned (fast månedlig tid)", () => {
    expect(
      suggestPrepaidPackage(
        [
          { month: "2026-07", hours: 10, value: 0 },
          { month: "2026-09", hours: 10, value: 0 },
        ],
        months,
      ),
    ).toBeNull();
  });

  it("springer kunder med for lidt eller for meget tid over", () => {
    const flat = (h: number) =>
      months.map((month) => ({ month, hours: h, value: h * 700 }));
    expect(suggestPrepaidPackage(flat(1.5), months)).toBeNull();
    expect(suggestPrepaidPackage(flat(41), months)).toBeNull();
    expect(suggestPrepaidPackage(flat(2), months)).not.toBeNull();
    expect(suggestPrepaidPackage(flat(40), months)).not.toBeNull();
  });

  it("timer uden sats trækker ikke snitsatsen ned", () => {
    const s = suggestPrepaidPackage(
      [
        { month: "2026-07", hours: 3, value: 2400, ratedHours: 3 },
        { month: "2026-08", hours: 4, value: 3200, ratedHours: 4 },
        { month: "2026-09", hours: 5, value: 0, ratedHours: 0 },
      ],
      months,
    );
    expect(s?.hourlyRate).toBe(800);
  });

  it("falder tilbage til kundens sats når historikken mangler sats", () => {
    const usage = months.map((month) => ({ month, hours: 3, value: 0 }));
    expect(suggestPrepaidPackage(usage, months, 650)?.hourlyRate).toBe(650);
    const none = suggestPrepaidPackage(usage, months, null);
    expect(none?.hourlyRate).toBeNull();
    expect(none?.totalPrice).toBeNull();
    expect(none?.hours).toBe(10);
  });
});

describe("nudge-afvisning", () => {
  const today = "2026-10-02";

  it("faktura-nudge snoozes 30 dage og vender så tilbage", () => {
    const key = nudgeDismissKey("invoice", CLIENT, today);
    expect(key).toBe(`nudge:invoice:${CLIENT}:2026-11-01`);
    expect(isNudgeDismissed([key], "invoice", CLIENT, today)).toBe(true);
    expect(isNudgeDismissed([key], "invoice", CLIENT, "2026-10-31")).toBe(true);
    expect(isNudgeDismissed([key], "invoice", CLIENT, "2026-11-01")).toBe(
      false,
    );
  });

  it("klippekort-forslag afvises permanent pr. kunde", () => {
    const key = nudgeDismissKey("prepaid", CLIENT, today);
    expect(key).toBe(`nudge:prepaid:${CLIENT}`);
    expect(isNudgeDismissed([key], "prepaid", CLIENT, "2030-01-01")).toBe(true);
  });

  it("gælder kun den kunde og type der blev afvist", () => {
    const keys = [
      nudgeDismissKey("invoice", CLIENT, today),
      "desktop-download",
    ];
    expect(isNudgeDismissed(keys, "invoice", OTHER, today)).toBe(false);
    expect(isNudgeDismissed(keys, "prepaid", CLIENT, today)).toBe(false);
    expect(isNudgeDismissed(null, "invoice", CLIENT, today)).toBe(false);
  });

  it("afviser nøgler med ugyldigt kunde-id", () => {
    expect(() => nudgeDismissKey("invoice", "x'; --", today)).toThrow();
  });
});
