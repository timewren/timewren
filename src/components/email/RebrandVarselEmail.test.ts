import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  RebrandVarselEmail,
  rebrandVarselIkrafttraedelse,
} from "./RebrandVarselEmail";

describe("rebrandVarselIkrafttraedelse", () => {
  it("lægger 30 kalenderdage til afsendelsesdagen", () => {
    expect(
      rebrandVarselIkrafttraedelse(new Date("2026-10-20T08:00:00+02:00")),
    ).toBe("19. november 2026");
  });

  it("bruger den danske dato, også lige efter midnat og over sommertidens slut", () => {
    // 1/10 00:30 dansk tid er 30/9 i UTC, og 25/10 skifter til vintertid undervejs.
    expect(
      rebrandVarselIkrafttraedelse(new Date("2026-10-01T00:30:00+02:00")),
    ).toBe("31. oktober 2026");
  });

  it("flytter ikke datoen, når sommertiden slutter undervejs", () => {
    // 30 x 24 timer fra 20/10 00:30 (sommertid) lander 18/11 23:30 (vintertid).
    expect(
      rebrandVarselIkrafttraedelse(new Date("2026-10-20T00:30:00+02:00")),
    ).toBe("19. november 2026");
  });
});

describe("RebrandVarselEmail", () => {
  it("viser ikrafttrædelsesdatoen og nævner kun udgivne apps", async () => {
    const tekst = await render(
      createElement(RebrandVarselEmail, {
        userName: "Mette",
        sentAt: new Date("2026-10-20T08:00:00+02:00"),
      }),
      { plainText: true },
    );
    expect(tekst).toContain("19. november 2026");
    expect(tekst).not.toContain("desktop-appen");
    expect(tekst).not.toMatch(/—|!/);
  });
});
