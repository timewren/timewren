import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "da") }));

afterEach(() => vi.unstubAllEnvs());

/** Siden for et ugyldigt link: ingen database, kun brand og tekster. */
const pageOn = async (host: string) =>
  (
    await GET(
      new NextRequest(`https://${host}/api/unsubscribe`, {
        headers: { host },
      }),
    )
  ).text();

describe("afmeldingssiden følger hostens brand", () => {
  it("TimeTrack som før på timetrack.dk", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    const html = await pageOn("timetrack.dk");
    expect(html).toContain(", TimeTrack</title>");
    expect(html).toContain('src="/brand/tt-ikon-64.png"');
    expect(html).toContain("inde i TimeTrack");
  });

  it("TimeWren uden TimeTrack på timewren.com", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    const html = await pageOn("timewren.com");
    expect(html).toContain(", TimeWren</title>");
    expect(html).toContain('src="/brand/timewren/mark-64.png"');
    expect(html).toContain('href="/dashboard/settings/notifications"');
    expect(html).not.toContain("TimeTrack");
  });

  it("uden flaget er timewren.com som før (build-brandet)", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    expect(await pageOn("timewren.com")).toContain(", TimeTrack</title>");
  });
});
