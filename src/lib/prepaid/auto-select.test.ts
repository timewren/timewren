import { describe, expect, it } from "vitest";
import {
  type AutoDeductCandidate,
  pickAutoDeductPackage,
  resolveTimerPrepaidSelection,
} from "./auto-select";

const now = new Date("2026-09-05T10:00:00Z");

const pkg = (
  over: Partial<AutoDeductCandidate> & { id: string },
): AutoDeductCandidate & { id: string } => ({
  autoDeduct: true,
  remainingHours: "10.00",
  expiryDate: null,
  isActive: true,
  ...over,
});

describe("pickAutoDeductPackage", () => {
  it("returnerer null uden kort", () => {
    expect(pickAutoDeductPackage(undefined, now)).toBeNull();
    expect(pickAutoDeductPackage([], now)).toBeNull();
  });

  it("vælger det kort der udløber først — ikke det nyeste i listen", () => {
    // Listen kommer nyeste-først fra serveren (desc purchaseDate)
    const picked = pickAutoDeductPackage(
      [
        pkg({ id: "nyt", expiryDate: new Date("2026-12-31T00:00:00Z") }),
        pkg({ id: "gammelt", expiryDate: new Date("2026-09-30T00:00:00Z") }),
      ],
      now,
    );
    expect(picked?.id).toBe("gammelt");
  });

  it("kort uden udløb kommer sidst", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({ id: "uden-udløb", expiryDate: null }),
        pkg({ id: "med-udløb", expiryDate: new Date("2026-12-01T00:00:00Z") }),
      ],
      now,
    );
    expect(picked?.id).toBe("med-udløb");
  });

  it("springer kort uden auto-træk, uden saldo, inaktive og udløbne over", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({ id: "manuelt", autoDeduct: false }),
        pkg({ id: "tomt", remainingHours: "0.00" }),
        pkg({ id: "tomt-tal", remainingHours: 0 }),
        pkg({ id: "inaktivt", isActive: false }),
        pkg({ id: "udløbet", expiryDate: new Date("2026-09-01T00:00:00Z") }),
        pkg({ id: "ok", expiryDate: null }),
      ],
      now,
    );
    expect(picked?.id).toBe("ok");
  });

  it("vælger stadig kortet på udløbsdagen frem til dansk midnat (#736)", () => {
    const expiring = [
      pkg({
        id: "udløber-i-dag",
        expiryDate: new Date("2026-09-05T00:00:00Z"),
      }),
      pkg({ id: "uden-udløb", expiryDate: null }),
    ];
    // 23:30 dansk sommertid på udløbsdagen
    expect(
      pickAutoDeductPackage(expiring, new Date("2026-09-05T21:30:00Z"))?.id,
    ).toBe("udløber-i-dag");
    // 00:01 dansk tid dagen efter
    expect(
      pickAutoDeductPackage(expiring, new Date("2026-09-05T22:01:00Z"))?.id,
    ).toBe("uden-udløb");
  });

  it("accepterer udløb som ISO-streng og saldo som tal", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({
          id: "sen",
          expiryDate: "2026-12-01T00:00:00.000Z",
          remainingHours: 3,
        }),
        pkg({
          id: "tidlig",
          expiryDate: "2026-10-01T00:00:00.000Z",
          remainingHours: 3,
        }),
      ],
      now,
    );
    expect(picked?.id).toBe("tidlig");
  });

  it("to kort uden udløb: det ÆLDSTE købte bruges først (FIFO, A1 P2-6)", () => {
    // Listen kommer nyeste-først (desc purchaseDate) — kunde-mønstret
    const picked = pickAutoDeductPackage(
      [
        pkg({ id: "købt-8-7", purchaseDate: new Date("2026-07-08T00:00:00Z") }),
        pkg({ id: "købt-1-7", purchaseDate: new Date("2026-07-01T00:00:00Z") }),
      ],
      now,
    );
    expect(picked?.id).toBe("købt-1-7");
  });

  it("samme udløbsdato: det ældste købte først, også som ISO-streng", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({
          id: "nyt",
          expiryDate: new Date("2026-12-01T00:00:00Z"),
          purchaseDate: "2026-08-01T00:00:00.000Z",
        }),
        pkg({
          id: "gammelt",
          expiryDate: new Date("2026-12-01T00:00:00Z"),
          purchaseDate: "2026-06-01T00:00:00.000Z",
        }),
      ],
      now,
    );
    expect(picked?.id).toBe("gammelt");
  });

  it("udløb vinder stadig over købsdato", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({
          id: "nyt-udløber-først",
          expiryDate: new Date("2026-10-15T00:00:00Z"),
          purchaseDate: new Date("2026-09-01T00:00:00Z"),
        }),
        pkg({
          id: "gammelt-uden-udløb",
          purchaseDate: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
      now,
    );
    expect(picked?.id).toBe("nyt-udløber-først");
  });

  it("manglende købsdato sorterer sidst — samme valg uanset rækkefølge (total orden)", () => {
    const a = pkg({ id: "uden-dato" });
    const b = pkg({
      id: "8-7",
      purchaseDate: new Date("2026-07-08T00:00:00Z"),
    });
    const c = pkg({
      id: "1-7",
      purchaseDate: new Date("2026-07-01T00:00:00Z"),
    });
    const orders = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const order of orders) {
      expect(pickAutoDeductPackage(order, now)?.id).toBe("1-7");
    }
    expect(pickAutoDeductPackage([a, b], now)?.id).toBe("8-7");
  });

  it("uden købsdato og samme udløb beholdes listens rækkefølge (stabil)", () => {
    const picked = pickAutoDeductPackage(
      [
        pkg({
          id: "først-i-listen",
          expiryDate: new Date("2026-12-01T00:00:00Z"),
        }),
        pkg({
          id: "sidst-i-listen",
          expiryDate: new Date("2026-12-01T00:00:00Z"),
        }),
      ],
      now,
    );
    expect(picked?.id).toBe("først-i-listen");
  });

  it("ændrer ikke input-listen", () => {
    const list = [
      pkg({ id: "b", expiryDate: new Date("2026-12-01T00:00:00Z") }),
      pkg({ id: "a", expiryDate: new Date("2026-10-01T00:00:00Z") }),
    ];
    pickAutoDeductPackage(list, now);
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("resolveTimerPrepaidSelection (timerens gemte valg, #422)", () => {
  const packages = [
    pkg({ id: "senere", expiryDate: new Date("2026-12-31T00:00:00Z") }),
    pkg({ id: "først", expiryDate: new Date("2026-09-30T00:00:00Z") }),
  ];

  it("bruger udløber-først-reglen uden valg", () => {
    expect(resolveTimerPrepaidSelection(null, "c1", packages, now)?.id).toBe(
      "først",
    );
  });

  it("respekterer et valgt kort og 'Intet klippekort' for kunden", () => {
    expect(
      resolveTimerPrepaidSelection(
        { mode: "package", packageId: "senere", clientId: "c1" },
        "c1",
        packages,
        now,
      )?.id,
    ).toBe("senere");
    expect(
      resolveTimerPrepaidSelection(
        { mode: "none", clientId: "c1" },
        "c1",
        packages,
        now,
      ),
    ).toBeNull();
  });

  it("erstatter aldrig et valgt kort der ikke længere findes med et andet", () => {
    expect(
      resolveTimerPrepaidSelection(
        { mode: "package", packageId: "væk", clientId: "c1" },
        "c1",
        packages,
        now,
      ),
    ).toBeNull();
  });

  it("ignorerer et valg truffet for en anden kunde", () => {
    expect(
      resolveTimerPrepaidSelection(
        { mode: "none", clientId: "anden" },
        "c1",
        packages,
        now,
      )?.id,
    ).toBe("først");
  });
});
