import { render } from "@react-email/render";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

async function renderWelcome(brandEnv: "timewren" | "timetrack") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BRAND", brandEnv);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tid.example.org");
  vi.stubEnv("EMAIL_DOMAIN", "tid.example.org");
  const { WelcomeEmail } = await import("./WelcomeEmail");
  const props = { userName: "Test" } as Parameters<typeof WelcomeEmail>[0];
  return render(createElement(WelcomeEmail, props));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mailramme og brand", () => {
  it("TimeWren: header, footer, hilsen og support bruger TimeWren", async () => {
    const html = await renderWelcome("timewren");
    expect(html).toContain("TimeWren");
    expect(html).toContain("Velkommen til TimeWren");
    expect(html).toContain(
      "https://tid.example.org/brand/timewren/mark-64.png",
    );
    expect(html).toContain("mailto:support@tid.example.org");
    expect(html).toContain("er open source og udgives af Mahope");
    expect(html).not.toContain("TimeTrack");
    expect(html).not.toContain("timetrack.dk");
  });

  it("TimeTrack: Cloud-mailen er uændret", async () => {
    const html = await renderWelcome("timetrack");
    expect(html).toContain("TimeTrack");
    expect(html).toContain("https://timetrack.dk/brand/tt-ikon-64.png");
    expect(html).toContain("mailto:support@timetrack.dk");
    expect(html).toContain("CVR 39413892");
    expect(html).not.toContain("TimeWren");
  });
});
