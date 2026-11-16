import { afterEach, expect, it, vi } from "vitest";
import { connectServer, serverFetch } from "./server-connection";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function setup(server: string, tokenServer: string | undefined) {
  const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({
          extensionSettings: { apiUrl: server },
          extensionToken: "token-a",
          extensionTokenServer: tokenServer,
          approvedServerOrigin: server,
        }),
      },
    },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
  });
  return fetcher;
}

it("never sends a token to another server or follows redirects", async () => {
  const fetcher = setup("https://tid.example.org", "https://tid.example.org");
  await expect(
    serverFetch("https://other.example/api/trpc", {}, "token-a"),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await serverFetch("https://tid.example.org/api/trpc", {}, "token-a");
  expect(fetcher).toHaveBeenCalledWith(
    "https://tid.example.org/api/trpc",
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
});

it("rejects a stale token after server switching", async () => {
  const fetcher = setup("https://other.example", "https://tid.example.org");
  await expect(
    serverFetch("https://other.example/api/trpc", {}, "token-a"),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires the stored token except for explicit manual validation", async () => {
  const fetcher = setup("https://tid.example.org", "https://tid.example.org");
  await expect(
    serverFetch("https://tid.example.org/api/trpc", {}, "stale"),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await serverFetch(
    "https://tid.example.org/api/trpc",
    {},
    "manual",
    "https://tid.example.org",
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

it("binds manual token validation to the server selected before pasting", async () => {
  const fetcher = setup("https://other.example", "https://other.example");
  await expect(
    serverFetch(
      "https://other.example/api/trpc",
      {},
      "manual",
      "https://tid.example.org",
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

function connection(queue: unknown[] = []) {
  let stored: Record<string, unknown> = {
    extensionSettings: { apiUrl: "https://timetrack.dk", theme: "dark" },
    extensionToken: "cloud-token",
    offlineQueue: queue,
    electricTimerOffset: "old-cursor",
  };
  const clear = vi.fn(async () => {
    stored = {};
  });
  const set = vi.fn(async (values: Record<string, unknown>) => {
    stored = { ...stored, ...values };
  });
  const request = vi.fn().mockResolvedValue(true);
  const remove = vi.fn().mockResolvedValue(true);
  const contains = vi.fn().mockResolvedValue(false);
  const reload = vi.fn();
  vi.stubGlobal("chrome", {
    storage: { local: { get: async () => stored, clear, set } },
    permissions: { request, remove, contains },
    runtime: { reload },
  });
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      protocol: "timetrack",
      product: "TimeWren",
      serverVersion: "test",
      apiVersion: { min: 1, max: 1 },
      authMethods: ["oauth"],
      urls: {
        deviceLogin: "https://tid.example.org/auth/device",
        trpc: "https://tid.example.org/api/trpc",
        stream: "https://tid.example.org/api/ext/stream",
      },
      capabilities: { realtime: true, electric: false, push: false },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  return {
    clear,
    set,
    request,
    remove,
    contains,
    reload,
    fetcher,
    read: () => stored,
  };
}

it("requests only the chosen origin, validates discovery, and drops old account data", async () => {
  const test = connection();
  const pending = connectServer("https://tid.example.org");
  expect(test.request).toHaveBeenCalledWith({
    origins: ["https://tid.example.org/*"],
  });
  expect(test.fetcher).not.toHaveBeenCalled();
  await pending;
  expect(test.read()).toEqual({
    extensionSettings: { apiUrl: "https://tid.example.org", theme: "dark" },
    approvedServerOrigin: "https://tid.example.org",
  });
  expect(test.reload).toHaveBeenCalledOnce();
  await connectServer("https://timetrack.dk");
  expect(test.read().extensionSettings).toEqual({
    apiUrl: "https://timetrack.dk",
    theme: "dark",
  });
  expect(test.read().extensionToken).toBeUndefined();
});

it("leaves the old server intact when permission is denied or offline work is pending", async () => {
  const test = connection();
  test.request.mockResolvedValue(false);
  await expect(connectServer("https://tid.example.org")).rejects.toThrow(
    "Giv udvidelsen adgang",
  );
  expect(test.clear).not.toHaveBeenCalled();
  expect(test.fetcher).not.toHaveBeenCalled();
  const offline = connection([{ type: "createTimeEntry" }]);
  await expect(connectServer("https://tid.example.org")).rejects.toThrow(
    "Synkroniser ventende registreringer",
  );
  expect(offline.clear).not.toHaveBeenCalled();
  expect(offline.read().extensionToken).toBe("cloud-token");
});

it("leaves tokens in place when the proposed server is not TimeTrack", async () => {
  const test = connection();
  test.fetcher.mockResolvedValue(Response.json({ protocol: "unrelated" }));
  await expect(connectServer("https://tid.example.org")).rejects.toThrow(
    "Det er ikke en TimeTrack-server",
  );
  expect(test.clear).not.toHaveBeenCalled();
  expect(test.reload).not.toHaveBeenCalled();
  expect(test.remove).toHaveBeenCalledWith({
    origins: ["https://tid.example.org/*"],
  });
});

it("revokes the old custom host permission when switching away", async () => {
  const test = connection();
  await connectServer("https://tid.example.org");
  await connectServer("https://timetrack.dk");
  expect(test.remove).toHaveBeenCalledWith({
    origins: ["https://tid.example.org/*"],
  });
});

it("connecting to Cloud with no saved apiUrl keeps the account", async () => {
  const test = connection();
  await chrome.storage.local.set({ extensionSettings: { theme: "dark" } });
  await connectServer("https://timetrack.dk");
  expect(test.clear).not.toHaveBeenCalled();
  expect(test.reload).not.toHaveBeenCalled();
  expect(test.read().extensionToken).toBe("cloud-token");
});

it.each([
  "https://timetrack.dk",
  "https://beta.timetrack.dk",
  "https://app.timetrack.dk",
  "https://www.timetrack.dk",
])("preserves legacy login on %s", async (origin) => {
  const fetcher = setup(origin, undefined);
  await serverFetch(`${origin}/api/trpc`, {}, "token-a");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("keeps explicit token bindings authoritative on built-in hosts", async () => {
  const fetcher = setup("https://beta.timetrack.dk", "https://timetrack.dk");
  await expect(
    serverFetch("https://beta.timetrack.dk/api/trpc", {}, "token-a"),
  ).rejects.toThrow("Log ind");
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not infer a legacy token binding for a custom server", async () => {
  const fetcher = setup("https://tid.example.org", undefined);
  await expect(
    serverFetch("https://tid.example.org/api/trpc", {}, "token-a"),
  ).rejects.toThrow("Log ind");
  expect(fetcher).not.toHaveBeenCalled();
});

it("connects to a private HTTP server in development with explicit permission", async () => {
  vi.stubEnv("MODE", "development");
  const test = connection();
  const origin = "http://192.168.1.2:3000";
  const document = await (await test.fetcher()).json();
  document.urls = {
    deviceLogin: `${origin}/auth/device`,
    trpc: `${origin}/api/trpc`,
    stream: `${origin}/api/ext/stream`,
  };
  test.fetcher.mockResolvedValue(Response.json(document));
  await connectServer(origin);
  expect(test.request).toHaveBeenCalledWith({ origins: [`${origin}/*`] });
  expect(test.read().approvedServerOrigin).toBe(origin);
});
