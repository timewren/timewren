import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_KEY,
  isChunkLoadError,
  reloadOnceForChunkError,
} from "../chunk-reload";
import { clearPrivateCaches } from "../private-caches";
import {
  sessionRetryDelay,
  shouldSignOutForMissingSession,
} from "../session-guard";
import { isAppReachable, isNewDeployment } from "../version";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("chunk-fejl efter deploy", () => {
  it.each([
    Object.assign(new Error("Loading chunk 123 failed."), {
      name: "ChunkLoadError",
    }),
    new Error("Failed to fetch dynamically imported module: /x.js"),
    new Error("Loading CSS chunk 7 failed"),
    new TypeError("error loading dynamically imported module"),
    new Error("Importing a module script failed."),
  ])("genkender %s", (error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("genkender ikke almindelige fejl", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of null"))).toBe(
      false,
    );
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("genindlæser én gang og ikke igen inden for vinduet", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const error = Object.assign(new Error("x"), { name: "ChunkLoadError" });

    expect(
      reloadOnceForChunkError(error, { storage, reload, now: 1_000 }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe("1000");

    expect(
      reloadOnceForChunkError(error, { storage, reload, now: 20_000 }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("må genindlæse igen ved et senere deploy", () => {
    const storage = memoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, "1000");
    const reload = vi.fn();
    const error = Object.assign(new Error("x"), { name: "ChunkLoadError" });
    expect(
      reloadOnceForChunkError(error, { storage, reload, now: 10 * 60_000 }),
    ).toBe(true);
  });

  it("genindlæser ikke ved andre fejl", () => {
    const reload = vi.fn();
    expect(
      reloadOnceForChunkError(new Error("boom"), {
        storage: memoryStorage(),
        reload,
        now: 1,
      }),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("manglende session i dashboardet", () => {
  it("logger ud, når serveren siger 401", () => {
    expect(
      shouldSignOutForMissingSession({ online: true, errorStatus: 401 }),
    ).toBe(true);
  });

  it("logger ud, når serveren svarer uden session og uden fejl", () => {
    expect(
      shouldSignOutForMissingSession({ online: true, errorStatus: null }),
    ).toBe(true);
  });

  it("logger ikke ud uden net (koldstart offline)", () => {
    expect(
      shouldSignOutForMissingSession({ online: false, errorStatus: null }),
    ).toBe(false);
  });

  it.each([0, 502, 503, undefined])(
    "logger ikke ud ved netværks-/serverfejl (%s)",
    (status) => {
      expect(
        shouldSignOutForMissingSession({
          online: true,
          errorStatus: status,
          hasError: true,
        }),
      ).toBe(false);
    },
  );
});

describe("ny version", () => {
  it("er kun ny, når der er en kendt baseline og en anden version", () => {
    expect(isNewDeployment(null, "b")).toBe(false);
    expect(isNewDeployment("a", null)).toBe(false);
    expect(isNewDeployment("a", "a")).toBe(false);
    expect(isNewDeployment("a", "b")).toBe(true);
  });
});

describe("rydning af caches ved logout/orgskift", () => {
  it("sletter alt fra timetrack undtagen build-filer og offline-side", async () => {
    const names = [
      "timetrack-v2",
      "timetrack-runtime-v2",
      "timetrack-runtime-v3",
      "timetrack-static-v3",
      "timetrack-shell-v3",
      "andet",
    ];
    const deleted: string[] = [];
    await clearPrivateCaches({
      keys: async () => names,
      delete: async (n: string) => {
        deleted.push(n);
        return true;
      },
    });
    expect(deleted.sort()).toEqual([
      "timetrack-runtime-v2",
      "timetrack-runtime-v3",
      "timetrack-v2",
    ]);
  });

  it("fejler aldrig, når Cache Storage mangler", async () => {
    await expect(clearPrivateCaches(undefined)).resolves.toBeUndefined();
  });
});

describe("genforsøg når sessionen ikke kan hentes", () => {
  it("venter eksponentielt længere med et loft", () => {
    expect(sessionRetryDelay(0)).toBe(2_000);
    expect(sessionRetryDelay(1)).toBe(4_000);
    expect(sessionRetryDelay(3)).toBe(16_000);
    expect(sessionRetryDelay(20)).toBe(60_000);
  });
});

describe("offline-siden: er appen nået igen?", () => {
  it("kun når /api/version faktisk svarer", async () => {
    const ok = vi.fn(
      async () => new Response('{"version":"abc"}', { status: 200 }),
    );
    expect(await isAppReachable(ok as never)).toBe(true);
    expect(ok).toHaveBeenCalledWith("/api/version", { cache: "no-store" });
  });

  it("ikke ved captive portal-svar eller netfejl", async () => {
    const portal = vi.fn(async () => new Response("login", { status: 511 }));
    expect(await isAppReachable(portal as never)).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await isAppReachable(down as never)).toBe(false);
  });
});
