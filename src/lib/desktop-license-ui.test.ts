import { describe, expect, it } from "vitest";
import { DESKTOP_LIFETIME_PRICE } from "./config";
import { desktopBuyButtonLabel } from "./desktop-license-ui";

describe("desktopBuyButtonLabel", () => {
  it("defaults to the current lifetime price (499 kr)", () => {
    expect(desktopBuyButtonLabel()).toBe(
      `Køb licens (${DESKTOP_LIFETIME_PRICE} kr)`,
    );
    expect(desktopBuyButtonLabel()).toBe("Køb licens (499 kr)");
  });

  it("accepts an explicit price override", () => {
    expect(desktopBuyButtonLabel(999)).toBe("Køb licens (999 kr)");
  });
});
