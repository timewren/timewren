import { afterEach, expect, it, vi } from "vitest";

const resolveServer = vi.hoisted(() => vi.fn());
vi.mock("../config", () => ({ resolveWebAppUrl: resolveServer }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function flow(callbackOrigin = "https://extension.chromiumapp.org") {
  resolveServer.mockReset().mockResolvedValue("https://tid.example.org");
  vi.stubGlobal("navigator", { userAgent: "Chrome" });
  vi.stubGlobal("chrome", {
    identity: {
      getRedirectURL: () => "https://extension.chromiumapp.org/",
      launchWebAuthFlow: vi.fn(async ({ url }: { url: string }) => {
        expect(new URL(url).origin).toBe("https://tid.example.org");
        const state = new URL(url).searchParams.get("state");
        return `${callbackOrigin}/#token=test-token&state=${state}`;
      }),
    },
  });
  return import("./oauth");
}

it("binds OAuth state and returned credentials to the chosen server", async () => {
  const { loginWithOAuth } = await flow();
  await expect(loginWithOAuth()).resolves.toEqual({
    token: "test-token",
    orgId: null,
    serverUrl: "https://tid.example.org",
  });
});

it("rejects a callback from another redirect origin", async () => {
  const { loginWithOAuth } = await flow("https://other.chromiumapp.org");
  await expect(loginWithOAuth()).rejects.toThrow();
});

it("rejects a callback after the selected server changes", async () => {
  const { loginWithOAuth } = await flow();
  resolveServer
    .mockResolvedValueOnce("https://tid.example.org")
    .mockResolvedValueOnce("https://timetrack.dk");
  await expect(loginWithOAuth()).rejects.toThrow("Serveren er ændret");
});
