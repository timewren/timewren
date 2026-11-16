import { NextRequest } from "next/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@/components/DocumentLayout";
import { WelcomeEmail } from "@/components/email/WelcomeEmail";
import { renderEmail } from "@/lib/email/render-email";
import { middleware } from "@/middleware";

vi.mock("@/app/globals.css", () => ({}));
vi.mock("next/font/google", () => ({
  Geist_Mono: () => ({ variable: "mono" }),
  Schibsted_Grotesk: () => ({ variable: "sans" }),
}));

// Snapshots er taget på main FØR multibrand-ændringerne. Går de i rødt, er
// timetrack.dk ændret.

afterEach(() => vi.unstubAllEnvs());

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: { host: new URL(url).host, ...headers },
  });
}

describe("timetrack.dk er uændret", () => {
  it("metadata (forsiden/login)", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    expect(JSON.stringify(metadata, null, 1)).toMatchSnapshot();
  });

  it("velkomstmail", async () => {
    const { html, text } = await renderEmail(
      createElement(WelcomeEmail, { userName: "Mette" }),
    );
    expect({ html, text }).toMatchSnapshot();
  });

  it.each(["/", "/login", "/dashboard", "/priser"])(
    "middleware %s giver samme svar med og uden flaget",
    (path) => {
      vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
      vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
      const snap = (r: Response) => ({
        status: r.status,
        location: r.headers.get("location"),
        robots: r.headers.get("x-robots-tag"),
        rewrite: r.headers.get("x-middleware-rewrite"),
      });
      const off = snap(middleware(req(`https://timetrack.dk${path}`)));
      vi.stubEnv("MULTIBRAND_ENABLED", "1");
      const on = snap(middleware(req(`https://timetrack.dk${path}`)));
      expect(on).toEqual(off);
      expect(off).toMatchSnapshot();
    },
  );
});
