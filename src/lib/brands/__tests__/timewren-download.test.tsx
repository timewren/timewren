import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAW_SITE_MESSAGES } from "../timewren-site-copy";
import { siteMetadata } from "../timewren-site-meta";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  bot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

const BASE = "https://github.com/mahope/timetrack-releases/releases/download";
const TT = `${BASE}/v0.2.30/TimeTrack_0.2.30_x64-setup.exe`;

beforeEach(() => {
  // Prod: one TimeTrack build serves both brands from one releases repo.
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.includes("timewren-stable")
          ? {
              version: "0.2.30",
              platforms: {
                "windows-x86_64": {
                  url: `${BASE}/timewren-v0.2.30/TimeWren_0.2.30_x64-setup.exe`,
                },
              },
            }
          : { version: "0.2.30", platforms: { "windows-x86_64": { url: TT } } },
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(ua: string, locale = "en") {
  requestHeaders = new Headers({ "user-agent": ua });
  const mod = await import(
    "@/app/(timewren)/timewren-site/[locale]/download/page"
  );
  const el = await mod.default({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(el);
}

/** The heading of the big card. */
function featured(html: string) {
  return html.match(/<h2 id="dl-featured">([^<]+)<\/h2>/)?.[1];
}

const en = RAW_SITE_MESSAGES.en.download as {
  featured: Record<string, string>;
};

describe("TimeWren download page", () => {
  it.each([
    ["iphone", "iphone"],
    ["android", "android"],
    ["mac", "mac"],
    ["windows", "windows"],
    ["bot", "web"],
  ] as const)("%s visitors see the %s card first", async (ua, key) => {
    const html = await render(UA[ua]);
    expect(featured(html)).toBe(en.featured[key]);
    // Every platform is listed below, whatever the guess.
    for (const t of ["ios", "android", "mac", "windows", "web"]) {
      expect(html).toContain(`data-target="${t}"`);
    }
    expect(html).not.toContain("<script");
  });

  it("links TimeWren's own installers, never TimeTrack's", async () => {
    const html = await render(UA.windows);
    expect(html).toContain("/timewren-v0.2.30/TimeWren_0.2.30_x64-setup.exe");
    expect(html).toContain("/timewren-v0.2.30/TimeWren_0.2.30_aarch64.dmg");
    expect(html).not.toContain("TimeTrack_");
    expect(html).not.toContain("releases/latest");
  });

  it("uses Apple's local badge and the TimeWren App Store app", async () => {
    const html = await render(UA.iphone, "da");
    expect(html).toContain('href="https://apps.apple.com/app/id6832757501"');
    expect(html).toContain('src="/badges/app-store/da-black.svg"');
    expect(html).toContain('alt="Hent i App Store"');
    expect(html).not.toContain("id6812371822");
  });

  it("shows Android as coming soon without a Play link", async () => {
    const html = await render(UA.android);
    expect(html).toContain("Coming soon to Google Play");
    expect(html).not.toContain("play.google.com");
  });

  it("gives Macs an iPad shortcut, since an iPad can send a Mac UA", async () => {
    const html = await render(UA.mac);
    expect(html).toContain('class="dl-ipad"');
    expect(html).toContain("Download for Apple silicon");
    expect(html).toContain("Download for Intel");
  });

  it("falls back to the release page when GitHub is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );
    const html = await render(UA.windows);
    expect(html).toContain(
      'href="https://github.com/mahope/timetrack-releases/releases/tag/timewren-stable"',
    );
  });

  it("has metadata with the Smart App Banner and hreflang", () => {
    const m = siteMetadata("/download", "de");
    expect(m.itunes).toEqual({ appId: "6832757501" });
    expect(m.alternates?.canonical).toBe("https://timewren.com/de/download");
    expect(m.title).toBe(
      (RAW_SITE_MESSAGES.de.meta as Record<string, { title: string }>).download
        .title,
    );
  });
});
