#!/usr/bin/env node
// Starts one standalone build several times with different runtime
// configuration and asserts on the rendered HTML (name and canonical), not just
// on headers (#1017).
//
//   npm run build   (any NEXT_PUBLIC_* build values)
//   node scripts/verify-runtime-instance.mjs [standalone-dir]
//
// With BUILD_PROFILE=selfhost the scenarios that need marketing pages are
// skipped and a selfhost-only one asserts that those pages are gone.
//
// Sets TT_VERIFY_EXPLORE=1 to print the observations instead of asserting.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? ".next/standalone");
if (!existsSync(resolve(dir, "server.js"))) {
  console.error(`No standalone build in ${dir}. Run npm run build first.`);
  process.exit(2);
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

async function waitFor(url, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("server exited early");
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server did not start: ${url}`);
}

async function withServer(env, fn) {
  const port = await freePort();
  const child = spawn("node", ["server.js"], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
      BETTER_AUTH_SECRET: "local-verify-only-not-a-production-secret",
      ...env,
    },
    stdio: "ignore",
  });
  try {
    await waitFor(`http://localhost:${port}/login`, child);
    return await fn(async (path) => {
      const res = await fetch(`http://localhost:${port}${path}`, {
        redirect: "manual",
      });
      return { status: res.status, html: await res.text(), res };
    });
  } finally {
    child.kill("SIGTERM");
  }
}

const meta = (html, re) => html.match(re)?.[1];
const canonical = (html) =>
  meta(html, /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/) ??
  meta(html, /<link[^>]*href="([^"]+)"[^>]*rel="canonical"/);
const siteName = (html) =>
  meta(html, /<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/) ??
  meta(html, /<meta[^>]*content="([^"]+)"[^>]*property="og:site_name"/);

// Operator pages say this; Cloud pages carry the real legal text instead.
const OPERATOR = /administratoren af denne instans/i;
const explore = process.env.TT_VERIFY_EXPLORE === "1";
let failures = 0;
function check(label, actual, expected) {
  const ok =
    typeof expected === "function" ? expected(actual) : actual === expected;
  if (explore) console.log(`${label}: ${JSON.stringify(actual)}`);
  else if (!ok) {
    failures++;
    console.error(
      `FAIL ${label}: got ${JSON.stringify(actual)}, expected ${String(expected)}`,
    );
  } else console.log(`ok   ${label}`);
}

const scenarios = [
  {
    name: "TimeTrack self-host",
    env: {
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://tt.example",
      NEXT_PUBLIC_MARKETING_URL: "",
    },
    run: async (get) => {
      const cookies = await get("/cookies");
      check("tt /cookies status", cookies.status, 200);
      check(
        "tt /cookies canonical",
        canonical(cookies.html),
        "https://tt.example/cookies",
      );
      check("tt /cookies og:site_name", siteName(cookies.html), "TimeTrack");
      const privacy = await get("/privacy");
      check(
        "tt /privacy canonical",
        canonical(privacy.html),
        "https://tt.example/privacy",
      );
      check(
        "tt /privacy directs to the operator",
        OPERATOR.test(privacy.html),
        true,
      );
      const root = await get("/");
      check(
        "tt / redirects to the app",
        root.res.headers.get("location"),
        (v) => v?.endsWith("/dashboard"),
      );
      const pricing = await get("/pricing");
      check("tt /pricing is closed", pricing.status, 404);
      const robots = await get("/robots.txt");
      check(
        "tt robots mentions no Cloud host",
        robots.html.includes("timetrack.dk"),
        false,
      );
    },
  },
  {
    name: "TimeWren self-host (same build)",
    env: {
      NEXT_PUBLIC_BRAND: "timewren",
      NEXT_PUBLIC_APP_URL: "https://tw.example",
      NEXT_PUBLIC_MARKETING_URL: "",
    },
    run: async (get) => {
      const cookies = await get("/cookies");
      check(
        "tw /cookies canonical",
        canonical(cookies.html),
        "https://tw.example/cookies",
      );
      check("tw /cookies og:site_name", siteName(cookies.html), "TimeWren");
      const privacy = await get("/privacy");
      check(
        "tw /privacy canonical",
        canonical(privacy.html),
        "https://tw.example/privacy",
      );
      check(
        "tw /privacy directs to the operator",
        OPERATOR.test(privacy.html),
        true,
      );
      check(
        "tw /privacy names the brand",
        privacy.html.includes("TimeWren"),
        true,
      );
    },
  },
  {
    name: "Explicit marketing opt-in on a self-host",
    needsMarketing: true,
    env: {
      NEXT_PUBLIC_BRAND: "timewren",
      NEXT_PUBLIC_APP_URL: "https://review.example",
      NEXT_PUBLIC_MARKETING_URL: "https://review.example",
    },
    run: async (get) => {
      const pricing = await get("/pricing");
      check("opt-in /pricing status", pricing.status, 200);
      check(
        "opt-in /pricing canonical",
        canonical(pricing.html),
        "https://review.example/pricing",
      );
      check("opt-in /pricing og:site_name", siteName(pricing.html), "TimeWren");
      const home = await get("/");
      check(
        "opt-in / canonical",
        canonical(home.html),
        (v) => !v || v.startsWith("https://review.example"),
      );
    },
  },
  {
    name: "Explicit marketing opt-in with the TimeTrack brand",
    needsMarketing: true,
    env: {
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://review.example",
      NEXT_PUBLIC_MARKETING_URL: "https://review.example",
    },
    run: async (get) => {
      for (const path of ["/pricing", "/blog/klippekort-skabelon"]) {
        const page = await get(path);
        check(`tt opt-in ${path} status`, page.status, 200);
        check(
          `tt opt-in ${path} canonical`,
          canonical(page.html),
          `https://review.example${path}`,
        );
        check(
          `tt opt-in ${path} og:site_name`,
          siteName(page.html),
          "TimeTrack",
        );
      }
      const config = await get("/runtime-config.js");
      check(
        "tt opt-in runtime-config",
        config.html.includes("review.example"),
        true,
      );
    },
  },
  {
    name: "Cloud image started for another Cloud URL",
    needsMarketing: true,
    env: {
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://timetrack.dk",
      NEXT_PUBLIC_MARKETING_URL: "https://timetrack.dk",
    },
    run: async (get) => {
      for (const path of [
        "/privacy",
        "/gdpr",
        "/terms",
        "/databehandleraftale",
      ]) {
        const page = await get(path);
        check(`cloud ${path} status`, page.status, 200);
        check(
          `cloud ${path} keeps the Cloud text`,
          OPERATOR.test(page.html),
          false,
        );
        check(
          `cloud ${path} canonical`,
          canonical(page.html),
          `https://timetrack.dk${path}`,
        );
      }
      const pricing = await get("/pricing");
      check(
        "cloud /pricing canonical",
        canonical(pricing.html),
        "https://timetrack.dk/pricing",
      );
    },
  },
  {
    name: "Beta without marketing URL",
    needsMarketing: true,
    env: {
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: "https://beta.timetrack.dk",
      NEXT_PUBLIC_MARKETING_URL: "",
    },
    run: async (get) => {
      const root = await get("/");
      check("beta / is marketing", root.status, 200);
      const pricing = await get("/pricing");
      check("beta /pricing status", pricing.status, 200);
      check(
        "beta /pricing canonical",
        canonical(pricing.html),
        "https://beta.timetrack.dk/pricing",
      );
      const privacy = await get("/privacy");
      check(
        "beta /privacy keeps the Cloud text",
        OPERATOR.test(privacy.html),
        false,
      );
    },
  },
];

// The selfhost profile (BUILD_PROFILE=selfhost, #1100) has no marketing pages
// at all, whatever the runtime configuration says.
scenarios.push({
  name: "Selfhost build profile ignores a marketing opt-in",
  selfhostOnly: true,
  env: {
    NEXT_PUBLIC_BRAND: "timetrack",
    NEXT_PUBLIC_APP_URL: "https://review.example",
    NEXT_PUBLIC_MARKETING_URL: "https://review.example",
  },
  run: async (get) => {
    const root = await get("/");
    check("selfhost opt-in / status", root.status, 307);
    check(
      "selfhost opt-in / redirects to the app",
      root.res.headers.get("location"),
      (v) => v?.endsWith("/dashboard"),
    );
    for (const path of ["/pricing", "/blog/klippekort-skabelon", "/features"]) {
      check(`selfhost opt-in ${path} is a 404`, (await get(path)).status, 404);
    }
    for (const path of [
      "/contact",
      "/download",
      "/download/success",
      "/slet-konto",
      "/gdpr",
      "/terms",
      "/privacy",
      "/databehandleraftale",
    ]) {
      check(`selfhost ${path} status`, (await get(path)).status, 200);
    }
    const cookies = await get("/cookies");
    check("selfhost opt-in /cookies status", cookies.status, 200);
    check(
      "selfhost opt-in /cookies canonical",
      canonical(cookies.html),
      "https://review.example/cookies",
    );
    const missing = await get("/no-such-page");
    check("selfhost unknown path is a 404", missing.status, 404);
  },
});

// The release repository is a build value. A compiled server chunk that still
// reads it from the environment would follow the running process instead.
function compiledRuntimeReads(root, needle) {
  const hits = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = resolve(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".js") && readFileSync(p, "utf8").includes(needle))
        hits.push(p);
    }
  };
  walk(root);
  return hits;
}
console.log("\n# Compiled server bundle");
check(
  "no runtime read of NEXT_PUBLIC_DESKTOP_RELEASES_REPO",
  compiledRuntimeReads(
    resolve(dir, ".next/server"),
    "process.env.NEXT_PUBLIC_DESKTOP_RELEASES_REPO",
  ),
  (hits) => hits.length === 0,
);

const selfhost = process.env.BUILD_PROFILE === "selfhost";
console.log(`Build profile: ${selfhost ? "selfhost" : "full"}`);
for (const s of scenarios) {
  if ((selfhost && s.needsMarketing) || (!selfhost && s.selfhostOnly)) continue;
  console.log(`\n# ${s.name}`);
  try {
    await withServer(s.env, s.run);
  } catch (error) {
    failures++;
    console.error(`FAIL ${s.name}: ${error.message}`);
  }
}
if (failures) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
