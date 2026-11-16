import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Lader som om screenshot-jobbets filer findes; indholdet er den gamle fil,
// så webp-målene kan læses.
const present = new Set<string>();
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const legacy = `${process.cwd()}/public/brand/timewren/screens/dashboard.webp`;
  return {
    ...fs,
    existsSync: (p: string) => [...present].some((f) => String(p).endsWith(f)),
    readFileSync: (p: string, ...rest: never[]) =>
      String(p).includes("/brand/timewren/screens/")
        ? fs.readFileSync(legacy)
        : fs.readFileSync(p, ...rest),
  };
});

const { Screen } = await import("@/components/timewren-site/Screen");

function render(preload: boolean, files: string[]) {
  present.clear();
  for (const f of files) present.add(f);
  return renderToStaticMarkup(
    <Screen
      name="dashboard"
      locale="en"
      alt="Dashboard"
      preload={preload}
      mobile="mobile-dashboard"
    />,
  );
}

const DESKTOP = "/screens/en/dashboard.webp";
const MOBILE = "/screens/en/mobile-dashboard.webp";

describe("Screen", () => {
  it("hero med mobilbillede hentes straks (picture-grenen)", () => {
    const html = render(true, [DESKTOP, MOBILE]);
    expect(html).toContain("<picture>");
    expect(html).toContain('loading="eager"');
    expect(html).not.toContain('loading="lazy"');
    expect(html).toMatch(/fetchPriority="high"|fetchpriority="high"/);
  });

  it("hero uden mobilbillede hentes straks", () => {
    const html = render(true, [DESKTOP]);
    expect(html).not.toContain("<picture>");
    expect(html).not.toContain('loading="lazy"');
  });

  it("under folden er begge grene lazy", () => {
    expect(render(false, [DESKTOP, MOBILE])).toContain('loading="lazy"');
    expect(render(false, [DESKTOP])).toContain('loading="lazy"');
  });
});
