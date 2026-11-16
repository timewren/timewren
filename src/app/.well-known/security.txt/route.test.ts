import { afterEach, describe, expect, it, vi } from "vitest";

async function securityTxt(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { GET } = await import("./route");
  return (await GET()).text();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("/.well-known/security.txt", () => {
  it("TimeTrack: security-adressen og timetrack.dk, ingen personlig adresse", async () => {
    const txt = await securityTxt({
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://timetrack.dk",
      NEXT_PUBLIC_MARKETING_URL: "",
      CONTACT_EMAIL: "anna@example.com",
    });
    expect(txt).toContain("Contact: mailto:security@timetrack.dk");
    expect(txt).toContain(
      "Canonical: https://timetrack.dk/.well-known/security.txt",
    );
    expect(txt).toContain("Policy: https://timetrack.dk/security-policy");
    expect(txt).toMatch(/^Expires: /m);
    expect(txt).not.toContain("anna@example.com");
    expect(txt).not.toMatch(/mahope/i);
    expect(txt.match(/^Contact: /gm)).toHaveLength(1);
  });

  it("TimeTrack med split: Canonical og Policy på marketing-hosten, ikke app-hosten", async () => {
    const txt = await securityTxt({
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://app.timetrack.dk",
      NEXT_PUBLIC_MARKETING_URL: "https://timetrack.dk",
    });
    expect(txt).toContain(
      "Canonical: https://timetrack.dk/.well-known/security.txt",
    );
    expect(txt).toContain("Policy: https://timetrack.dk/security-policy");
    expect(txt).not.toContain("app.timetrack.dk");
  });

  it("TimeWren med egen marketing-URL: stadig ingen Policy-linje", async () => {
    const txt = await securityTxt({
      NEXT_PUBLIC_BRAND: "timewren",
      NEXT_PUBLIC_APP_URL: "https://tid.example.org",
      NEXT_PUBLIC_MARKETING_URL: "https://www.example.org",
      SUPPORT_EMAIL: "support@tid.example.org",
    });
    expect(txt).not.toMatch(/^Policy: /m);
    expect(txt).not.toMatch(/timetrack/i);
  });

  it("TimeWren: brandets supportadresse og instansens URL, intet fra TimeTrack", async () => {
    const txt = await securityTxt({
      NEXT_PUBLIC_BRAND: "timewren",
      NEXT_PUBLIC_APP_URL: "https://tid.example.org/",
      NEXT_PUBLIC_MARKETING_URL: "",
      SUPPORT_EMAIL: "support@tid.example.org",
      CONTACT_EMAIL: "anna@example.com",
    });
    expect(txt).toContain("Contact: mailto:support@tid.example.org");
    expect(txt).toContain(
      "Canonical: https://tid.example.org/.well-known/security.txt",
    );
    // /security-policy findes ikke på selvhost (marketingsti, 404) og er
    // TimeTrack-brandet, så linjen udelades.
    expect(txt).not.toMatch(/^Policy: /m);
    expect(txt).toContain("# TimeWren Security Policy");
    expect(txt).not.toMatch(/timetrack|mahope/i);
    expect(txt).not.toContain("anna@example.com");
  });
});
