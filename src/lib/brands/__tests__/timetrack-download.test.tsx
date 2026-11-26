import { prerenderToNodeStream } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /download på timetrack.dk: enhedens kort først, alle platforme nedenunder,
// og kun TimeTracks egne apps og installere.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("@/app/globals.css", () => ({}));
// Navigation og Footer oversættes på serveren (se
// timetrack-marketing-unchanged.test.tsx).
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { loadMessages } = await import("@/i18n/messages/load");
  const { brandize } = await import("@/i18n/brandize");
  return {
    getTranslations: async (
      opts: string | { locale: string; namespace: string },
    ) => {
      const { locale, namespace } =
        typeof opts === "string" ? { locale: "da", namespace: opts } : opts;
      const messages = brandize(await loadMessages(locale as "da"));
      return createTranslator({ locale, messages, namespace } as never);
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/download",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const BASE = "https://github.com/mahope/timetrack-releases/releases/download";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        version: "0.2.30",
        platforms: {
          "windows-x86_64": {
            url: `${BASE}/v0.2.30/TimeTrack_0.2.30_x64-setup.exe`,
          },
        },
      }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(ua: string) {
  requestHeaders = new Headers({ "user-agent": ua });
  const mod = await import("@/components/instance-pages/DownloadPage");
  const { prelude } = await prerenderToNodeStream(await mod.default());
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return html.replace(/<!--.*?-->/g, "");
}

function featured(html: string) {
  return html.match(/id="dl-featured"[^>]*>([^<]+)</)?.[1];
}

describe("timetrack.dk/download", () => {
  it.each([
    ["iphone", "Til din iPhone"],
    ["ipad", "Til din iPad"],
    ["android", "Til din Android-telefon"],
    ["mac", "Til din Mac"],
    ["windows", "Til din Windows-pc"],
    ["linux", "I din browser"],
  ] as const)("%s: %s først, alle platforme nedenunder", async (ua, title) => {
    const html = await render(UA[ua]);
    expect(featured(html)).toBe(title);
    for (const t of ["ios", "android", "mac", "windows", "web"]) {
      expect(html).toContain(`data-target="${t}"`);
    }
  });

  it("linker TimeTracks egne apps og installere", async () => {
    const html = await render(UA.mac);
    expect(html).toContain('href="https://apps.apple.com/app/id6812371822"');
    expect(html).toContain('src="/badges/app-store/da-black.svg"');
    expect(html).toContain('alt="Hent i App Store"');
    expect(html).toContain("/v0.2.30/TimeTrack_0.2.30_aarch64.dmg");
    expect(html).toContain("/v0.2.30/TimeTrack_0.2.30_x64.dmg");
    expect(html).toContain("/v0.2.30/TimeTrack_0.2.30_x64-setup.exe");
    expect(html).not.toContain("TimeWren");
    expect(html).not.toContain("id6832757501");
    // En iPad med Mac-UA kan ikke ses på serveren: genvejen står under kortet.
    expect(html).toContain("Er du på en iPad?");
  });

  it("selvhostet: ingen App Store-reklame for en app, der ikke kan bruge serveren", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tid.example.org");
    const html = await render(UA.iphone);
    expect(featured(html)).toBe("Til din iPhone");
    expect(html).not.toContain("apps.apple.com");
    expect(html).toContain("kan endnu ikke forbinde til denne server");
  });

  it("viser Android som kommer snart uden Play-link", async () => {
    const html = await render(UA.android);
    expect(html).toContain("Kommer snart i Google Play");
    expect(html).not.toContain("play.google.com");
  });

  it("JSON-LD nævner alle platforme", async () => {
    const html = await render(UA.windows);
    const ld = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ??
        "{}",
    );
    expect(ld["@type"]).toBe("SoftwareApplication");
    expect(ld.operatingSystem).toContain("iOS");
    expect(ld.operatingSystem).toContain("macOS");
    expect(ld.operatingSystem).toContain("Windows");
  });
});
