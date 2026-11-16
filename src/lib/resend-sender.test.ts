import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("afsendere i resend.ts", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.PERSONAL_FROM_EMAIL;
    delete process.env.EMAIL_DOMAIN;
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://timetrack.dk";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("afleder noreply@ fra marketing-værten og lader personlig afsender følge den", async () => {
    const mod = await import("./resend");
    expect(mod.DEFAULT_FROM_EMAIL).toBe("noreply@timetrack.dk");
    expect(mod.PERSONAL_FROM_EMAIL).toBe("noreply@timetrack.dk");
  });

  it("bruger PERSONAL_FROM_EMAIL og RESEND_FROM_EMAIL når de er sat", async () => {
    process.env.RESEND_FROM_EMAIL = "TimeTrack <hej@example.org>";
    process.env.PERSONAL_FROM_EMAIL = "Mads Holst Jensen <mads@timetrack.dk>";
    const mod = await import("./resend");
    expect(mod.DEFAULT_FROM_EMAIL).toBe("TimeTrack <hej@example.org>");
    expect(mod.PERSONAL_FROM_EMAIL).toBe(
      "Mads Holst Jensen <mads@timetrack.dk>",
    );
  });
});
