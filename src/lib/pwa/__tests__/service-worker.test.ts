import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * public/sw.js er et klassisk service worker-script uden moduler, så det
 * køres her i en vm-sandbox med en minimal `self`/`caches`-attrap.
 */

type Handler = (event: unknown) => void;

class FakeCache {
  entries = new Map<string, Response>();
  failPut = false;
  async match(req: Request | string) {
    const key = typeof req === "string" ? req : new URL(req.url).pathname;
    return this.entries.get(key)?.clone();
  }
  async put(req: Request | string, res: Response) {
    if (this.failPut) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    const key = typeof req === "string" ? req : new URL(req.url).pathname;
    this.entries.set(key, res);
  }
  async add(req: Request | string) {
    const url = typeof req === "string" ? req : req.url;
    const res = await (
      globalThis as unknown as { swFetch: typeof fetch }
    ).swFetch(url);
    if (!res.ok) throw new TypeError("bad response");
    await this.put(new Request(new URL(url, ORIGIN)), res);
  }
  async keys() {
    return [...this.entries.keys()].map((k) => new Request(new URL(k, ORIGIN)));
  }
  async delete(req: Request) {
    return this.entries.delete(new URL(req.url).pathname);
  }
}

const ORIGIN = "https://app.timetrack.dk";

function loadServiceWorker(
  options: {
    fetchImpl?: typeof fetch;
    existingCaches?: string[];
    failPut?: boolean;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const store = new Map<string, FakeCache>();
  for (const name of options.existingCaches ?? []) {
    store.set(name, new FakeCache());
  }
  const fetchImpl =
    options.fetchImpl ??
    (vi.fn(async () => new Response("net", { status: 200 })) as never);
  (globalThis as unknown as { swFetch: typeof fetch }).swFetch = fetchImpl;

  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) {
        const cache = new FakeCache();
        cache.failPut = !!options.failPut;
        store.set(name, cache);
      }
      return store.get(name) as FakeCache;
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: Request | string) => {
      for (const cache of store.values()) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, handler: Handler) =>
      handlers.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    registration: {},
  };

  const code = readFileSync(resolve(__dirname, "../../../../public/sw.js"), {
    encoding: "utf-8",
  });
  vm.runInNewContext(code, {
    self,
    caches,
    fetch: fetchImpl,
    // I en rigtig SW løses relative URL'er mod scriptets origin.
    Request: class extends Request {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, ORIGIN) : input, init);
      }
    },
    Response,
    URL,
    Promise,
    Set,
    DOMException,
    console: { log() {}, warn() {}, error() {} },
  });

  function dispatchFetch(url: string, init: { mode?: RequestMode } = {}) {
    const request = {
      url: new URL(url, ORIGIN).href,
      method: "GET",
      mode: init.mode ?? "cors",
      destination: "",
      headers: new Headers(),
    };
    let responded: Promise<Response> | null = null;
    handlers.get("fetch")?.({
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
    });
    return responded as Promise<Response> | null;
  }

  const pending: Promise<unknown>[] = [];
  async function settle() {
    await Promise.allSettled(pending.splice(0));
  }

  async function dispatchMessage(data: unknown) {
    let waited: Promise<unknown> = Promise.resolve();
    handlers.get("message")?.({
      data,
      waitUntil: (p: Promise<unknown>) => {
        waited = p;
      },
    });
    await waited;
  }

  async function runLifecycle(type: "install" | "activate") {
    let waited: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({
      waitUntil: (p: Promise<unknown>) => {
        waited = p;
      },
    });
    await waited;
  }

  return { dispatchFetch, dispatchMessage, runLifecycle, settle, store };
}

describe("service worker: private svar caches aldrig", () => {
  it.each([
    "/api/trpc/timerSync.getState?batch=1&input=%7B%7D",
    "/api/realtime",
    "/api/auth/get-session",
    "/api/shapes/time",
  ])("rører ikke %s (ren netværksadgang)", (path) => {
    const sw = loadServiceWorker();
    expect(sw.dispatchFetch(path)).toBeNull();
  });

  it("rører ikke RSC-svar", () => {
    const sw = loadServiceWorker();
    expect(sw.dispatchFetch("/dashboard/time?_rsc=abc123")).toBeNull();
  });

  it("gemmer ikke navigationssvar, men viser offline-siden uden net", async () => {
    let online = true;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (!online) throw new TypeError("Failed to fetch");
      if (url.includes("/offline")) {
        return new Response("<html>offline-side</html>", { status: 200 });
      }
      return new Response("<html>privat dashboard</html>", { status: 200 });
    }) as unknown as typeof fetch;
    const sw = loadServiceWorker({ fetchImpl });
    await sw.runLifecycle("install");

    const first = await sw.dispatchFetch("/dashboard", { mode: "navigate" });
    expect(await first?.text()).toBe("<html>privat dashboard</html>");

    online = false;
    const second = await sw.dispatchFetch("/dashboard", { mode: "navigate" });
    expect(await second?.text()).toBe("<html>offline-side</html>");
  });

  it("precacher offline-siden og de build-filer den henviser til", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/offline")) {
        return new Response(
          '<html><script src="/_next/static/chunks/offline-abc.js"></script></html>',
          { status: 200 },
        );
      }
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const sw = loadServiceWorker({ fetchImpl });
    await sw.runLifecycle("install");

    const shell = sw.store.get("timetrack-shell-v3");
    expect(await shell?.match("/offline")).toBeTruthy();
    // Offline-sidens filer ligger i shell-cachen, som loftet ikke rydder.
    expect(
      await shell?.match("/_next/static/chunks/offline-abc.js"),
    ).toBeTruthy();
  });

  it("sletter gamle caches ved aktivering", async () => {
    const sw = loadServiceWorker({
      existingCaches: [
        "timetrack-v2",
        "timetrack-runtime-v2",
        "timetrack-offline-v2",
        "timetrack-static-v3",
        "andet-bibliotek",
      ],
    });
    await sw.runLifecycle("activate");
    expect([...sw.store.keys()].sort()).toEqual([
      "andet-bibliotek",
      "timetrack-static-v3",
    ]);
  });
});

describe("service worker: cache-skrivning må aldrig vælte et svar", () => {
  it("leverer netværkssvaret, selv når cachen er fuld", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("js", { status: 200 }),
    ) as unknown as typeof fetch;
    const sw = loadServiceWorker({ fetchImpl, failPut: true });
    const res = await sw.dispatchFetch("/_next/static/chunks/a.js");
    expect(await res?.text()).toBe("js");
    await sw.settle();
  });

  it("cacher ikke delvise svar (206)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("del", {
          status: 206,
          headers: { "content-range": "bytes 0-2/10" },
        }),
    ) as unknown as typeof fetch;
    const sw = loadServiceWorker({ fetchImpl });
    const res = await sw.dispatchFetch("/_next/static/media/v.mp4");
    expect(res?.status).toBe(206);
    await sw.settle();
    const statics = sw.store.get("timetrack-static-v3");
    expect(await statics?.match("/_next/static/media/v.mp4")).toBeFalsy();
  });

  it("cacher almindelige 200-svar", async () => {
    const sw = loadServiceWorker();
    await sw.dispatchFetch("/_next/static/chunks/b.js");
    await sw.settle();
    const statics = sw.store.get("timetrack-static-v3");
    expect(await statics?.match("/_next/static/chunks/b.js")).toBeTruthy();
  });
});

describe("service worker: offline-siden følger med nye builds", () => {
  it("henter offline-siden igen, når appens version skifter", async () => {
    let build = "build-1";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/offline")) {
        return new Response(
          `<html><script src="/_next/static/chunks/${build}.js"></script></html>`,
          { status: 200 },
        );
      }
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const sw = loadServiceWorker({ fetchImpl });
    await sw.runLifecycle("install");
    await sw.dispatchMessage({ type: "APP_VERSION", version: "build-1" });

    build = "build-2";
    await sw.dispatchMessage({ type: "APP_VERSION", version: "build-1" });
    let shell = sw.store.get("timetrack-shell-v3");
    expect(await shell?.match("/_next/static/chunks/build-2.js")).toBeFalsy();

    await sw.dispatchMessage({ type: "APP_VERSION", version: "build-2" });
    shell = sw.store.get("timetrack-shell-v3");
    expect(await shell?.match("/_next/static/chunks/build-2.js")).toBeTruthy();
    expect(await shell?.match("/_next/static/chunks/build-1.js")).toBeFalsy();
  });
});
