import { describe, expect, it } from "vitest";
// Paritetstest ligger i extensionen, ikke i src/: browser-extension/ er
// udeladt af Docker-build-konteksten, så en import herfra i src/ brækker
// next build's typecheck (main 5/9-2026). Root-vitest inkluderer denne fil.
import { pickAutoDeductPackage } from "../../../src/lib/prepaid/auto-select";
import { prepaidDaysUntilExpiry } from "../../../src/lib/prepaid/expiry";
import type { PrepaidPackage as ExtensionPrepaidPackage } from "../types";
import { daysUntilPrepaidExpiry, pickAutoPrepaid } from "./prepaid";

const now = new Date("2026-09-05T10:00:00Z");

/**
 * Paritet med extensionen (#422): samme kort skal vælges uanset om der
 * trykkes stop i web eller i extensionen. Fixtures spejler hvad serveren
 * leverer til hver flade (web: expiryDate som Date, extension: expiresAt
 * som ISO-streng) — begge nyeste-først.
 */
describe("paritet: web-regel == extensionens pickAutoPrepaid", () => {
  type Fixture = {
    id: string;
    expiry: string | null;
    autoDeduct: boolean;
    remaining: number;
    purchased: string;
  };
  const fixtures: Fixture[] = [
    {
      id: "nyt-uden-udløb",
      expiry: null,
      autoDeduct: true,
      remaining: 20,
      purchased: "2026-07-08T00:00:00.000Z",
    },
    {
      id: "nyt-sen",
      expiry: "2026-12-31T00:00:00.000Z",
      autoDeduct: true,
      remaining: 5,
      purchased: "2026-07-05T00:00:00.000Z",
    },
    {
      id: "manuelt",
      expiry: "2026-09-10T00:00:00.000Z",
      autoDeduct: false,
      remaining: 5,
      purchased: "2026-06-20T00:00:00.000Z",
    },
    {
      id: "tomt",
      expiry: "2026-09-11T00:00:00.000Z",
      autoDeduct: true,
      remaining: 0,
      purchased: "2026-06-10T00:00:00.000Z",
    },
    {
      id: "gammelt-tidlig",
      expiry: "2026-09-30T00:00:00.000Z",
      autoDeduct: true,
      remaining: 2.5,
      purchased: "2026-05-01T00:00:00.000Z",
    },
  ];

  const scenarios: Array<[string, Fixture[]]> = [
    ["fuldt sæt", fixtures],
    ["kun uden udløb", fixtures.filter((f) => f.expiry === null)],
    [
      "to med udløb",
      fixtures.filter((f) => f.id === "nyt-sen" || f.id === "gammelt-tidlig"),
    ],
    ["ingen auto", fixtures.filter((f) => !f.autoDeduct)],
    ["omvendt rækkefølge", [...fixtures].reverse()],
    [
      "to uden udløb: ældste købte først (FIFO)",
      [
        fixtures[0],
        {
          id: "gammelt-uden-udløb",
          expiry: null,
          autoDeduct: true,
          remaining: 25.75,
          purchased: "2026-07-01T00:00:00.000Z",
        },
      ],
    ],
  ];

  for (const [name, set] of scenarios) {
    it(name, () => {
      const web = pickAutoDeductPackage(
        set.map((f) => ({
          id: f.id,
          autoDeduct: f.autoDeduct,
          remainingHours: f.remaining.toFixed(2),
          expiryDate: f.expiry ? new Date(f.expiry) : null,
          purchaseDate: new Date(f.purchased),
          isActive: true,
        })),
        now,
      );
      const ext = pickAutoPrepaid(
        set.map(
          (f): ExtensionPrepaidPackage => ({
            id: f.id,
            clientId: "klient-1",
            clientName: "Eksempel ApS",
            name: f.id,
            totalHours: 35,
            usedHours: 35 - f.remaining,
            remainingHours: f.remaining,
            expiresAt: f.expiry,
            purchasedAt: f.purchased,
            isActive: true,
            autoDeduct: f.autoDeduct,
          }),
        ),
        "klient-1",
      );
      expect(web?.id ?? null).toBe(ext?.id ?? null);
    });
  }

  it("manglende købsdato sorterer sidst på begge flader (total orden)", () => {
    const base = {
      clientId: "klient-1",
      clientName: "Eksempel ApS",
      totalHours: 35,
      usedHours: 0,
      remainingHours: 5,
      expiresAt: null,
      isActive: true,
      autoDeduct: true,
    };
    const a: ExtensionPrepaidPackage = { ...base, id: "uden-dato", name: "a" };
    const b: ExtensionPrepaidPackage = {
      ...base,
      id: "8-7",
      name: "b",
      purchasedAt: "2026-07-08T00:00:00.000Z",
    };
    const c: ExtensionPrepaidPackage = {
      ...base,
      id: "1-7",
      name: "c",
      purchasedAt: "2026-07-01T00:00:00.000Z",
    };
    for (const order of [
      [a, b, c],
      [b, a, c],
      [c, a, b],
      [a, c, b],
    ]) {
      expect(pickAutoPrepaid(order, "klient-1")?.id).toBe("1-7");
      const web = pickAutoDeductPackage(
        order.map((p) => ({
          id: p.id,
          autoDeduct: true,
          remainingHours: p.remainingHours,
          expiryDate: null,
          purchaseDate: p.purchasedAt ?? null,
          isActive: true,
        })),
        now,
      );
      expect(web?.id).toBe("1-7");
    }
  });

  it("FIFO: begge flader vælger det ældste af to kort uden udløb", () => {
    const set = scenarios.find(([n]) => n.startsWith("to uden udløb"))?.[1];
    const ext = pickAutoPrepaid(
      (set ?? []).map(
        (f): ExtensionPrepaidPackage => ({
          id: f.id,
          clientId: "klient-1",
          clientName: "Eksempel ApS",
          name: f.id,
          totalHours: 35,
          usedHours: 35 - f.remaining,
          remainingHours: f.remaining,
          expiresAt: f.expiry,
          purchasedAt: f.purchased,
          isActive: true,
          autoDeduct: f.autoDeduct,
        }),
      ),
      "klient-1",
    );
    expect(ext?.id).toBe("gammelt-uden-udløb");
  });
});

describe("udløbsdage — paritet med web (#736)", () => {
  it("tæller hele danske kalenderdage som web-appen", () => {
    const expiries = [
      "2026-08-15T00:00:00.000Z",
      "2026-12-15T00:00:00.000Z",
      "2026-08-14T22:00:00.000Z",
      "2026-10-25T00:00:00.000Z",
    ];
    const nows = [
      "2026-08-14T22:30:00Z", // 00:30 dansk på udløbsdagen
      "2026-08-15T21:30:00Z", // 23:30 dansk på udløbsdagen
      "2026-08-15T22:01:00Z", // 00:01 dansk dagen efter
      "2026-12-14T23:30:00Z",
      "2026-12-15T23:01:00Z",
      "2026-10-25T22:30:00Z",
      "2026-10-25T23:01:00Z",
    ];
    for (const expiry of expiries) {
      for (const now of nows) {
        expect(daysUntilPrepaidExpiry(expiry, new Date(now))).toBe(
          prepaidDaysUntilExpiry(expiry, new Date(now)),
        );
      }
    }
    expect(daysUntilPrepaidExpiry(null)).toBeNull();
  });
});
