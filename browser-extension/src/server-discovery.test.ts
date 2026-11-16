import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverServer, normalizeServerAddress } from "./server-discovery";

afterEach(() => vi.unstubAllGlobals());

describe("normalizeServerAddress", () => {
  it("accepts HTTPS origins and rejects credentials, paths and public HTTP", () => {
    expect(normalizeServerAddress(" https://tid.example.org/ ")).toBe(
      "https://tid.example.org",
    );
    for (const value of [
      "http://tid.example.org",
      "https://user:pass@tid.example.org",
      "https://tid.example.org/path",
      "https://tid.example.org?token=secret",
      "https://tid.example.org#fragment",
      "javascript:alert(1)",
    ]) {
      expect(() => normalizeServerAddress(value)).toThrow();
    }
  });

  it("only allows local HTTP when explicitly enabled for development", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "192.168.1.2",
      "10.0.0.1",
      "172.16.0.2",
      "[::1]",
    ]) {
      expect(() => normalizeServerAddress(`http://${host}:3000`)).toThrow();
      expect(normalizeServerAddress(`http://${host}:3000`, true)).toBe(
        `http://${host}:3000`,
      );
    }
    expect(() => normalizeServerAddress("http://172.32.0.1", true)).toThrow();
    expect(() =>
      normalizeServerAddress("http://localhost.evil.test", true),
    ).toThrow();
  });
});

function document() {
  return {
    protocol: "timetrack",
    product: "TimeWren",
    serverVersion: "test-build",
    apiVersion: { min: 1, max: 1 },
    authMethods: ["device-login", "oauth"],
    urls: {
      deviceLogin: "https://tid.example.org/auth/device",
      trpc: "https://tid.example.org/api/trpc",
      stream: "https://tid.example.org/api/ext/stream",
    },
    capabilities: { realtime: true, electric: false, push: false },
  };
}

describe("discoverServer", () => {
  it("fetches discovery without cookies or redirects and accepts TimeWren", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(document()));
    vi.stubGlobal("fetch", fetcher);
    expect((await discoverServer("https://tid.example.org")).product).toBe(
      "TimeWren",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://tid.example.org/.well-known/timetrack.json",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });

  it("rejects unrelated servers and endpoints that would leak a token", async () => {
    for (const value of [
      {},
      { ...document(), protocol: "other" },
      {
        ...document(),
        urls: { ...document().urls, trpc: "https://evil.example/api/trpc" },
      },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
      await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
        "Det er ikke en TimeTrack-server",
      );
    }
  });

  it("distinguishes old servers, old clients and connection failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...document(), apiVersion: { min: 0, max: 0 } }),
        ),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Serveren er for gammel til denne app (kræver API ≥ 1)",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...document(), apiVersion: { min: 2, max: 2 } }),
        ),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Denne app er for gammel til serveren",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Kan ikke nå serveren",
    );
  });

  it("handles unavailable, non-JSON and upgrade-required responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Kan ikke nå serveren",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>login</html>")),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Det er ikke en TimeTrack-server",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 426 })),
    );
    await expect(discoverServer("https://tid.example.org")).rejects.toThrow(
      "Denne app er for gammel til serveren",
    );
  });
});
