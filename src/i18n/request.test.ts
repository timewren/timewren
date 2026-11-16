import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: mocks.profile } } },
}));

import requestConfig from "./request";

// getRequestConfig's wrapper is replaced above so the real resolver runs with
// isolated request/auth data and never touches a database.
const resolveLocale = () =>
  requestConfig({ requestLocale: Promise.resolve(undefined) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.headers.mockResolvedValue(new Headers());
  mocks.session.mockResolvedValue(null);
});

describe("request locale", () => {
  it("answers an explicit locale without reading cookies or headers", async () => {
    // Statisk renderede marketingsider (CookieConsent, Navigation, Footer)
    // giver sproget udtrykkeligt; et opslag i forespørgslen gør dem dynamiske.
    const result = await requestConfig({
      requestLocale: Promise.resolve(undefined),
      locale: "da",
    });
    expect(result.locale).toBe("da");
    expect(result.messages).toHaveProperty("chrome");
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it.each(["da", "en"])(
    "prefers the %s cookie without querying auth",
    async (locale) => {
      mocks.cookies.mockResolvedValue({ get: () => ({ value: locale }) });
      const result = await resolveLocale();
      expect(result.locale).toBe(locale);
      expect(result.messages).toHaveProperty("nav");
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks.profile).not.toHaveBeenCalled();
    },
  );

  it.each(["da", "en"])(
    "uses the authenticated %s profile without a cookie",
    async (locale) => {
      mocks.session.mockResolvedValue({ user: { id: "test-user" } });
      mocks.profile.mockResolvedValue({ locale });
      mocks.headers.mockResolvedValue(
        new Headers({ "accept-language": locale === "en" ? "da" : "en" }),
      );
      expect((await resolveLocale()).locale).toBe(locale);
      expect(mocks.profile).toHaveBeenCalledOnce();
    },
  );

  it.each(["da", "en"])(
    "falls back to the %s browser language",
    async (locale) => {
      mocks.headers.mockResolvedValue(
        new Headers({ "accept-language": `${locale},fr;q=0.8` }),
      );
      expect((await resolveLocale()).locale).toBe(locale);
    },
  );

  it("defaults to Danish for an unsupported cookie", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "fr" }) });
    expect((await resolveLocale()).locale).toBe("da");
  });

  it("keeps the browser language when auth is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("auth unavailable"));
    mocks.headers.mockResolvedValue(new Headers({ "accept-language": "en" }));
    expect((await resolveLocale()).locale).toBe("en");
  });
});
