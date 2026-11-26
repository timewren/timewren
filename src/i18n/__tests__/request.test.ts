import { cookies, headers } from "next/headers";
import type { getRequestConfig } from "next-intl/server";
import { afterEach, expect, it, vi } from "vitest";
import { LOCALE_HEADER } from "@/lib/brands/registry";
import requestConfig from "../request";

vi.mock("next-intl/server", () => ({
  getRequestConfig: (configure: Parameters<typeof getRequestConfig>[0]) =>
    configure,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(
    async () => new Headers({ host: "timewren.com", [LOCALE_HEADER]: "da" }),
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  ["timetrack", "TimeTrack"],
  ["timewren", "TimeWren"],
])(
  "uses the configured %s brand for an explicit locale",
  async (brand, name) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", brand);
    vi.stubEnv("MULTIBRAND_ENABLED", "1");

    const config = await requestConfig({
      locale: "en",
      requestLocale: Promise.resolve("da"),
    });

    expect(config).toMatchObject({
      locale: "en",
      messages: {
        serverExports: {
          readme: {
            orgTitle: expect.stringContaining(`${name}: full data export`),
          },
        },
      },
    });
    expect(headers).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  },
);

it("uses the host brand when the locale comes from the request", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("MULTIBRAND_ENABLED", "1");

  const config = await requestConfig({ requestLocale: Promise.resolve("da") });

  expect(config).toMatchObject({
    locale: "da",
    messages: {
      serverExports: {
        readme: { orgTitle: expect.stringContaining("TimeWren: fuld eksport") },
      },
    },
  });
});
