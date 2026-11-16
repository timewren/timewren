import { describe, expect, it } from "vitest";
// Paritetstest ligger i extensionen, ikke i src/ (se prepaid-parity.test.ts):
// browser-extension/ er udeladt af Docker-build-konteksten.
import { klippekortModel as webModel } from "../../../src/components/klippekort/huller-model";
import { klippekortModel } from "./klippekort-huller";

/**
 * Samme kort skal se ens ud i app, portal og extension (BRAND.md →
 * Klippekortet: regler). Modellen er kopieret til extensionen; denne test
 * fejler, hvis kopien glider fra web-udgaven.
 */
describe("paritet: extensionens klippekort-huller == web-modellen", () => {
  const cases: Array<[number, number]> = [
    [20, 7],
    [20, 20],
    [20, 0],
    [20, -3],
    [10, 7.5],
    [7.5, 0],
    [21, 21],
    [50, 17.5],
    [200, 120],
    [205, 10],
    [0, 0],
    [1, 0.25],
    [Number.NaN, 4],
  ];

  for (const [total, remaining] of cases) {
    it(`${total} t, ${remaining} tilbage`, () => {
      expect(klippekortModel(total, remaining)).toEqual(
        webModel(total, remaining),
      );
    });
  }

  it("popup-eksemplet: 7 t tilbage af 20, 13 brugte huller", () => {
    const m = klippekortModel(20, 7);
    expect(m.label).toBe("7 t tilbage af 20");
    expect(m.holes.filter((h) => h === "brugt")).toHaveLength(13);
  });
});
