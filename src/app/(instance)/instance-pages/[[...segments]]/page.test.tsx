import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import InstancePage, { generateMetadata } from "./page";

vi.mock("@/components/Navigation", () => ({ Navigation: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const { default: chrome } = await import("@/i18n/messages/en/chrome.json");
  return {
    ...(await importOriginal<typeof import("next-intl/server")>()),
    getTranslations: () =>
      createTranslator({
        locale: "en",
        messages: { chrome },
        namespace: "chrome.instance",
      }),
  };
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["timetrack", "TimeTrack", "https://alpha.example"],
  ["timewren", "TimeWren", "https://beta.example"],
])(
  "renders operator content and runtime metadata for %s",
  async (id, name, url) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", id);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
    vi.stubEnv("SUPPORT_EMAIL", "operator@example.org");
    const cookies = { params: Promise.resolve({ segments: ["cookies"] }) };
    const html = renderToStaticMarkup(await InstancePage(cookies));
    expect(html).toContain(`${name} har en meget minimal cookie-politik`);
    expect(html).toContain('href="mailto:operator@example.org"');
    expect(html).not.toContain("timetrack@timetrack.dk");
    const metadata = await generateMetadata(cookies);
    expect(String(metadata.alternates?.canonical)).toBe(`${url}/cookies`);
    expect(metadata.openGraph?.siteName).toBe(name);

    for (const segment of ["privacy", "gdpr", "terms", "databehandleraftale"]) {
      const page = await InstancePage({
        params: Promise.resolve({ segments: [segment] }),
      });
      const legalHtml = renderToStaticMarkup(page);
      expect(legalHtml).toContain("instance");
      expect(legalHtml).toContain(`Contact ${name}`);
      expect(legalHtml).toContain('href="/contact"');
      expect(legalHtml).not.toMatch(
        /Mahope|timetrack@timetrack\.dk|TimeTrack Cloud/,
      );
    }
  },
);

it("retains Cloud legal content when rendering runtime metadata", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://timetrack.dk");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
  const props = { params: Promise.resolve({ segments: ["privacy"] }) };
  const html = renderToStaticMarkup(await InstancePage(props));
  expect(html).toContain("39413892");
  expect(String((await generateMetadata(props)).alternates?.canonical)).toBe(
    "https://timetrack.dk/privacy",
  );
});

it.each([
  "https://timetrack.dk",
  "https://app.timetrack.dk",
  "https://beta.timetrack.dk",
])("keeps every Cloud legal text with runtime metadata on %s", async (url) => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
  for (const segment of ["privacy", "gdpr", "terms", "databehandleraftale"]) {
    const props = { params: Promise.resolve({ segments: [segment] }) };
    const html = renderToStaticMarkup(await InstancePage(props));
    expect(html).not.toContain("Contact TimeTrack");
    expect(html).not.toMatch(
      /instance.s administrator|administratoren af denne instans/i,
    );
    expect(String((await generateMetadata(props)).alternates?.canonical)).toBe(
      `${url}/${segment}`,
    );
  }
});

it("uses runtime site metadata and preserves Cloud editorial claims", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.instance.example");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://instance.example");
  const pricing = await generateMetadata({
    params: Promise.resolve({ segments: ["pricing"] }),
  });
  expect(String(pricing.alternates?.canonical)).toBe(
    "https://instance.example/pricing",
  );
  expect(pricing.description).toContain("Priser på TimeTrack");
  expect(pricing.openGraph?.description).toEqual(pricing.description);
  const about = await generateMetadata({
    params: Promise.resolve({ segments: ["about"] }),
  });
  expect(about.description).toContain("TimeTrack er lavet og drevet");
  expect(pricing.openGraph?.siteName).toBe("TimeWren");
  const home = await generateMetadata({ params: Promise.resolve({}) });
  expect(home.title).toEqual({
    absolute: expect.stringContaining("TimeTrack"),
  });
});

it("retains the Twitter card from a nested marketing layout", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.instance.example");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://instance.example");
  const metadata = await generateMetadata({
    params: Promise.resolve({ segments: ["effihub-alternativ"] }),
  });
  expect(metadata.twitter).toMatchObject({
    card: "summary_large_image",
    title: "TimeTrack og Effihub sammenlignet",
  });
});

it("uses the runtime article URL and preserves the original publisher", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.instance.example");
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://instance.example");
  const props = {
    params: Promise.resolve({ segments: ["blog", "klippekort-skabelon"] }),
  };
  const metadata = await generateMetadata(props);
  const html = renderToStaticMarkup(await InstancePage(props));
  const script = html.match(
    /<script type="application\/ld\+json">([^<]*)<\/script>/,
  );
  expect(JSON.parse(script?.[1] ?? "{}")).toMatchObject({
    publisher: { name: "TimeTrack", url: "https://timetrack.dk" },
    mainEntityOfPage: { "@id": String(metadata.alternates?.canonical) },
  });
  expect(metadata.publisher).toBe("TimeTrack");
});
