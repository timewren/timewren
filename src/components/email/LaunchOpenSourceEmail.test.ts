import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_OPEN_SOURCE_SUBJECT,
  LaunchOpenSourceEmail,
} from "./LaunchOpenSourceEmail";

describe("LaunchOpenSourceEmail", () => {
  it("bruger det godkendte emne", () => {
    expect(LAUNCH_OPEN_SOURCE_SUBJECT).toBe(
      "Jeg åbner kildekoden til TimeTrack: hvad det betyder for dig",
    );
  });

  it("hilser med fornavn og nævner supportadresse og gratis måned", async () => {
    const tekst = await render(
      createElement(LaunchOpenSourceEmail, { userName: "__FORNAVN__" }),
      { plainText: true },
    );
    expect(tekst).toContain("Hej __FORNAVN__,");
    expect(tekst.replace(/\s+/g, " ")).toContain(
      "Vil du senere flytte til det nye domæne, er det helt frivilligt.",
    );
    expect(tekst).toContain("mads@timetrack.dk");
    expect(tekst).toContain("én måned gratis");
    expect(tekst).toContain("Founding customer");
  });

  it("hilser uden navn, når fornavnet mangler", async () => {
    const tekst = await render(createElement(LaunchOpenSourceEmail, {}), {
      plainText: true,
    });
    expect(tekst).toContain("Hej,");
    expect(tekst).not.toContain("Hej undefined");
  });
});
