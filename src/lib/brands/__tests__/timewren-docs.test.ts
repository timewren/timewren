import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "@/middleware";
import {
  docsMarkdownPath,
  docsPath,
  isDocsFilePath,
  prefersMarkdown,
  routeDocs,
} from "../timewren-docs";

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: { host: new URL(url).host, ...headers },
  });
}

const snap = (r: Response) => ({
  status: r.status,
  location: r.headers.get("location"),
  robots: r.headers.get("x-robots-tag"),
  rewrite: r.headers.get("x-middleware-rewrite"),
  locale: r.headers.get("x-middleware-request-x-brand-locale"),
  vary: r.headers.get("vary"),
});

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("BRANDS_CONFIG", "");
  vi.stubEnv("TIMEWREN_INDEXABLE", "");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("routeDocs", () => {
  it.each([
    ["/docs", "/timewren-site/docs/en"],
    ["/docs/install/quick", "/timewren-site/docs/en/install/quick"],
    ["/da/docs", "/timewren-site/docs/da"],
    ["/de/docs/api/rest", "/timewren-site/docs/de/api/rest"],
    [
      "/es/docs/configuration/environment",
      "/timewren-site/docs/es/configuration/environment",
    ],
  ])("%s → HTML %s", (path, to) => {
    expect(routeDocs(path)).toMatchObject({ action: "docs", to });
  });

  it.each([
    ["/docs.md", "/timewren-site/docs-md/en"],
    ["/docs/install/quick.md", "/timewren-site/docs-md/en/install/quick"],
    ["/da/docs.md", "/timewren-site/docs-md/da"],
    ["/es/docs/api/mcp.md", "/timewren-site/docs-md/es/api/mcp"],
  ])("%s → Markdown %s", (path, to) => {
    expect(routeDocs(path)).toMatchObject({ action: "docs-md", to });
  });

  it("Accept: text/markdown giver Markdown på samme sti", () => {
    expect(routeDocs("/docs/quickstart", "text/markdown")).toMatchObject({
      action: "docs-md",
      to: "/timewren-site/docs-md/en/quickstart",
    });
    // Browsere sender text/html først: de får HTML.
    expect(
      routeDocs(
        "/docs/quickstart",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ),
    ).toMatchObject({ action: "docs" });
  });

  it.each([
    ["/en/docs", "/docs"],
    ["/en/docs/quickstart", "/docs/quickstart"],
    ["/docs/", "/docs"],
    ["/da/docs/install/", "/da/docs/install"],
    ["/en/docs/quickstart.md", "/docs/quickstart.md"],
    // Sprog uden oversættelse falder tilbage til engelsk.
    ["/fr/docs", "/docs"],
    ["/fr/docs/quickstart", "/docs/quickstart"],
    ["/fr/docs/quickstart.md", "/docs/quickstart.md"],
    ["/fr/docs.md", "/docs.md"],
  ])("%s omdirigeres til den kanoniske %s", (path, to) => {
    expect(routeDocs(path)).toEqual({ action: "redirect", to });
  });

  it.each([
    "/",
    "/pricing",
    "/docsx",
    "/docs/Install",
    "/docs/a..b",
    "/docs/%2e%2e/etc",
  ])("%s er ikke en docs-sti", (path) => {
    expect(routeDocs(path)).toBeNull();
  });

  it("llms.txt, llms-full.txt og søgningen", () => {
    expect(routeDocs("/llms.txt")).toEqual({ action: "llms" });
    expect(routeDocs("/llms-full.txt")).toEqual({ action: "llms-full" });
    expect(routeDocs("/docs-search")).toEqual({ action: "docs-search" });
  });

  it("stier og Markdown-stier", () => {
    expect(docsPath([], "en")).toBe("/docs");
    expect(docsPath(["api", "rest"], "da")).toBe("/da/docs/api/rest");
    expect(docsMarkdownPath([], "de")).toBe("/de/docs.md");
    expect(docsMarkdownPath(["llm"], "en")).toBe("/docs/llm.md");
  });

  it("prefersMarkdown", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.5")).toBe(true);
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });
});

describe("TimeWren-docs i middleware (timewren.com)", () => {
  it("docs-sider omskrives internt med sprog og Vary, uden noindex", () => {
    const r = snap(middleware(req("https://timewren.com/da/docs/quickstart")));
    expect(r.rewrite).toBe(
      "https://timewren.com/timewren-site/docs/da/quickstart",
    );
    expect(r.locale).toBe("da");
    expect(r.robots).toBeNull();
    expect(r.vary).toBe("Accept");
  });

  it("docs svarer, selv om appen er lukket på TimeWren-hosten", () => {
    const r = snap(middleware(req("https://timewren.com/docs")));
    expect(r.rewrite).toBe("https://timewren.com/timewren-site/docs/en");
  });

  it("Markdown via .md og via Accept", () => {
    expect(
      snap(middleware(req("https://timewren.com/docs/api/rest.md"))).rewrite,
    ).toBe("https://timewren.com/timewren-site/docs-md/en/api/rest");
    expect(
      snap(
        middleware(
          req("https://timewren.com/docs/api/rest", {
            accept: "text/markdown",
          }),
        ),
      ).rewrite,
    ).toBe("https://timewren.com/timewren-site/docs-md/en/api/rest");
  });

  it("llms.txt, llms-full.txt og søgning", () => {
    expect(snap(middleware(req("https://timewren.com/llms.txt"))).rewrite).toBe(
      "https://timewren.com/timewren-site/llms",
    );
    expect(
      snap(middleware(req("https://timewren.com/llms-full.txt"))).rewrite,
    ).toBe("https://timewren.com/timewren-site/llms-full");
    expect(
      snap(middleware(req("https://timewren.com/docs-search?query=x"))).rewrite,
    ).toBe("https://timewren.com/timewren-site/docs-search?query=x");
  });

  it("kanoniske omdirigeringer bevarer query", () => {
    const r = snap(middleware(req("https://timewren.com/en/docs/llm?x=1")));
    expect(r.status).toBe(308);
    expect(r.location).toBe("https://timewren.com/docs/llm?x=1");
  });

  it("HTML-sider indekseres, Markdown og llms.txt aldrig", () => {
    expect(
      snap(middleware(req("https://timewren.com/docs"))).robots,
    ).toBeNull();
    expect(
      snap(middleware(req("https://timewren.com/docs/llm.md"))).robots,
    ).toBe("noindex, nofollow");
    expect(snap(middleware(req("https://timewren.com/llms.txt"))).robots).toBe(
      "noindex, nofollow",
    );
  });

  it("app.timewren.com har ingen docs", () => {
    for (const path of ["/docs", "/llms.txt", "/docs/llm.md"]) {
      const r = snap(middleware(req(`https://app.timewren.com${path}`)));
      expect(r.rewrite ?? "").not.toContain("/timewren-site/");
    }
  });
});

describe("Værtsgrænsen: timetrack.dk får ingen TimeWren-docs", () => {
  const paths = [
    "/docs",
    "/docs/quickstart",
    "/da/docs",
    "/docs.md",
    "/docs/quickstart.md",
    "/llms.txt",
    "/llms-full.txt",
    "/docs-search",
    "/install.sh",
  ];

  it.each(paths)("timetrack.dk%s rører ikke TimeWren-ruterne", (path) => {
    for (const host of ["timetrack.dk", "app.timetrack.dk"]) {
      const r = snap(middleware(req(`https://${host}${path}`)));
      expect(r.rewrite ?? "").not.toContain("/timewren-site/");
      expect(r.location ?? "").not.toContain("timewren");
    }
  });

  it.each(paths)(
    "uden multibrand (selvhost/Cloud) rører %s ikke TimeWren-ruterne",
    (path) => {
      vi.stubEnv("MULTIBRAND_ENABLED", "");
      const r = snap(middleware(req(`https://timetrack.dk${path}`)));
      expect(r.rewrite ?? "").not.toContain("/timewren-site/");
    },
  );

  it("timetrack.dk/llms.txt og .md-stier får uændret svar (next)", () => {
    for (const path of ["/llms.txt", "/llms-full.txt", "/docs/quickstart.md"]) {
      const r = middleware(req(`https://timetrack.dk${path}`));
      expect(r.headers.get("x-middleware-next")).toBe("1");
      expect(r.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("de interne docs-ruter kan ikke nås direkte på nogen host", () => {
    for (const host of ["timetrack.dk", "timewren.com"]) {
      for (const path of [
        "/timewren-site/docs/en",
        "/timewren-site/docs-md/en/llm",
        "/timewren-site/llms",
        "/timewren-site/llms-full",
        "/timewren-site/docs-search",
      ]) {
        const r = snap(middleware(req(`https://${host}${path}`)));
        expect(r.rewrite).toBe(`https://${host}/_marketing-disabled`);
      }
    }
  });
});

describe("Middleware-matcheren", () => {
  it.each([
    "/docs",
    "/da/docs/api/rest",
    "/docs.md",
    "/docs/install/quick.md",
    "/es/docs.md",
    "/es/docs/api/mcp.md",
    "/llms.txt",
    "/llms-full.txt",
    "/docs-search",
  ])("matcher %s", (path) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: `https://timewren.com${path}`,
      }),
    ).toBe(true);
  });

  it.each(["/brand/timewren/mark.svg", "/README.md", "/notes/docs.md"])(
    "matcher ikke andre filer: %s",
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://timewren.com${path}`,
        }),
      ).toBe(false);
    },
  );

  it("isDocsFilePath følger matcherens filstier", () => {
    expect(isDocsFilePath("/llms.txt")).toBe(true);
    expect(isDocsFilePath("/da/docs/llm.md")).toBe(true);
    expect(isDocsFilePath("/docs")).toBe(false);
    expect(isDocsFilePath("/README.md")).toBe(false);
  });
});
