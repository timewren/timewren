import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findViolations } from "./check-build-profile.mjs";

describe("check-build-profile", () => {
  it("flags static, re-exported and dynamic imports into an omitted group", () => {
    const files: [string, string][] = [
      ["src/a.ts", `import X from "@/app/(marketing)/pricing/page";`],
      ["src/b.ts", `export { default } from "../app/(timewren)/x/page";`],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      ["src/c.ts", "const m = await import(`../app/(marketing)/${s}/page`);"],
      ["src/d.ts", `const ok = "uses (marketing) in prose only";`],
      ["src/e.ts", 'await import(\n  "@/app/(marketing)/pricing/page"\n)'],
    ];
    expect(findViolations(files).map((v: string) => v.split(":")[0])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/e.ts",
    ]);
  });

  it("lets the marketing loader through, the file the profile aliases away", () => {
    const loader = `import("../app/(marketing)/page")`;
    expect(
      findViolations([["src/lib/instance-marketing-loader.ts", loader]]),
    ).toEqual([]);
  });

  it("passes on the real source tree", () => {
    const run = spawnSync(
      process.execPath,
      ["scripts/check-build-profile.mjs"],
      { encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});
