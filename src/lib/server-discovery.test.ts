import { afterEach, describe, expect, it, vi } from "vitest";
import { serverDiscovery } from "./server-discovery";

afterEach(() => vi.unstubAllEnvs());

describe("serverDiscovery", () => {
  it("uses the configured public origin, never the request host", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tid.example.org");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    const info = serverDiscovery();
    expect(info.product).toBe("TimeWren");
    expect(info.protocol).toBe("timetrack");
    expect(info.apiVersion).toEqual({ min: 1, max: 1 });
    expect(info.serverVersion).toEqual(expect.any(String));
    expect(info.urls).toEqual({
      deviceLogin: "https://tid.example.org/auth/device",
      trpc: "https://tid.example.org/api/trpc",
      stream: "https://tid.example.org/api/ext/stream",
    });
    expect(info.authMethods).toEqual(["device-login", "oauth"]);
  });

  it("reports capabilities without exposing secrets or promising native push", () => {
    vi.stubEnv("REALTIME_ENABLED", "true");
    vi.stubEnv("VALKEY_URL", "redis://secret@localhost");
    vi.stubEnv("ELECTRIC_URL", "http://electric:3000");
    vi.stubEnv("ELECTRIC_SECRET", "private-value");
    expect(serverDiscovery().capabilities).toEqual({
      realtime: true,
      electric: true,
      push: false,
    });
    expect(JSON.stringify(serverDiscovery())).not.toContain("private-value");
    vi.stubEnv("ELECTRIC_SECRET", "");
    vi.stubEnv("REALTIME_ENABLED", "false");
    expect(serverDiscovery().capabilities).toEqual({
      realtime: false,
      electric: false,
      push: false,
    });
  });
});
