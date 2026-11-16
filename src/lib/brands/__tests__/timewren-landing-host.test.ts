import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

function req(url: string) {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
});
afterEach(() => vi.unstubAllEnvs());

// Forsiden linker til docs, llms.txt og install.sh. De adresser må kun give
// TimeWren-indhold på TimeWren-hosten, aldrig på timetrack.dk.
const LINKED = [
  "/docs",
  "/docs/install/quick",
  "/da/docs/llm",
  "/llms.txt",
  "/llms-full.txt",
  "/install.sh",
];

describe("TimeWren-forsidens adresser på timetrack.dk", () => {
  it.each(LINKED)("%s giver intet TimeWren-indhold", (path) => {
    for (const host of ["timetrack.dk", "app.timetrack.dk"]) {
      const res = middleware(req(`https://${host}${path}`));
      expect(res.headers.get("x-middleware-request-x-brand")).toBeNull();
      expect(res.headers.get("x-middleware-rewrite") ?? "").not.toContain(
        "/timewren-site",
      );
      expect(res.headers.get("location") ?? "").not.toContain("timewren");
    }
  });

  it("forsidens egne stier på timetrack.dk rammer ikke TimeWren-sitet", () => {
    for (const path of ["/", "/da", "/self-hosting", "/pricing"]) {
      const res = middleware(req(`https://timetrack.dk${path}`));
      expect(res.headers.get("x-middleware-rewrite") ?? "").not.toContain(
        "/timewren-site",
      );
    }
  });

  it("kontrol: samme tjek fanger TimeWren-sitet på TimeWren-hosten", () => {
    const res = middleware(req("https://timewren.com/"));
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/timewren-site/en",
    );
  });
});

/*
 * Middleware-headerne alene beviser ikke, hvad timetrack.dk svarer: en
 * almindelig route-handler (fx src/app/install.sh/route.ts fra et andet job)
 * kører uden rewrite. Her findes den route, Next ville vælge for stien uden
 * for TimeWren-sitet, og dens faktiske svar på timetrack.dk tjekkes.
 */
const APP_DIR = join(process.cwd(), "src/app");

type Route = { file: string; segments: string[] };

function appRoutes(dir = APP_DIR): Route[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // TimeWren-sitet nås kun via rewrite fra TimeWren-hosten (testet ovenfor).
      return e.name === "(timewren)" ? [] : appRoutes(full);
    }
    if (!/^(route\.ts|page\.tsx)$/.test(e.name)) return [];
    const segments = relative(APP_DIR, dir)
      .split(sep)
      .filter((x) => x && !/^\(.*\)$/.test(x) && !x.startsWith("@"));
    return [{ file: full, segments }];
  });
}

/** 0 = statisk, 1 = [x], 2 = [...x], 3 = [[...x]] (Nexts rækkefølge). */
const rank = (seg: string) =>
  seg.startsWith("[[...")
    ? 3
    : seg.startsWith("[...")
      ? 2
      : seg.startsWith("[")
        ? 1
        : 0;

function matches(route: string[], path: string[]): boolean {
  if (route.length === 0) return path.length === 0;
  const [head, ...rest] = route;
  const r = rank(head);
  if (r >= 2) return path.length >= (r === 3 ? 0 : 1);
  if (path.length === 0) return false;
  return (r === 1 || head === path[0]) && matches(rest, path.slice(1));
}

function resolveRoute(path: string): Route | undefined {
  const parts = path.split("/").filter(Boolean);
  const hits = appRoutes().filter((r) => matches(r.segments, parts));
  const key = (r: Route) => parts.map((_, i) => rank(r.segments[i] ?? "[[..."));
  hits.sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    const i = ka.findIndex((v, n) => v !== kb[n]);
    return i < 0 ? 0 : ka[i] - kb[i];
  });
  return hits[0];
}

async function responseBody(path: string, host: string): Promise<string> {
  const route = resolveRoute(path);
  if (!route) return "404";
  const mod = await import(route.file);
  const params = Promise.resolve({});
  try {
    if (route.file.endsWith("route.ts")) {
      const res: Response = await mod.GET(req(`https://${host}${path}`), {
        params,
      });
      return await res.text();
    }
    return renderToStaticMarkup(
      await mod.default({ params, searchParams: params }),
    );
  } catch (err) {
    if ((err as Error).message === "NEXT_NOT_FOUND") return "404";
    throw err;
  }
}

describe("svarene fra TimeWren-forsidens adresser på timetrack.dk", () => {
  it.each(LINKED)("%s svarer uden TimeWren-indhold", async (path) => {
    for (const host of ["timetrack.dk", "app.timetrack.dk"]) {
      const body = await responseBody(path, host);
      expect(body, `${host}${path}`).not.toMatch(/timewren/i);
    }
  });

  it("kontrol: /llms.txt rammer TimeTracks egen route og svarer med TimeTrack", async () => {
    expect(resolveRoute("/llms.txt")?.file).toBe(
      join(APP_DIR, "llms.txt/route.ts"),
    );
    expect(await responseBody("/llms.txt", "timetrack.dk")).toContain(
      "# TimeTrack",
    );
  });

  it("kontrol: ukendte stier som /docs ender i marketingens 404", () => {
    expect(resolveRoute("/docs/install/quick")?.file).toBe(
      join(APP_DIR, "(marketing)/[...notFound]/page.tsx"),
    );
  });
});
