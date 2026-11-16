import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appUrlEnv,
  brandEnv,
  marketingUrlEnv,
  renderRuntimeConfigScript,
  runtimeBuildMismatches,
} from "./runtime-env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime-env (server)", () => {
  it("læser værdierne fra process.env ved kørsel, ikke fra et build-øjebliksbillede", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://a.example");
    expect(appUrlEnv()).toBe("https://a.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://b.example");
    expect(appUrlEnv()).toBe("https://b.example");
  });

  it("giver undefined for tom/manglende værdi", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    expect(marketingUrlEnv()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_BRAND", "");
    expect(brandEnv()).toBeUndefined();
  });
});

describe("runtime-env (klient)", () => {
  it("klienten bruger window.__TT_CONFIG__ frem for env", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://build.example");
    vi.stubGlobal("window", {
      __TT_CONFIG__: {
        appUrl: "https://runtime.example",
        marketingUrl: "https://www.runtime.example",
        brand: "timetrack",
      },
    });
    expect(appUrlEnv()).toBe("https://runtime.example");
    expect(marketingUrlEnv()).toBe("https://www.runtime.example");
    expect(brandEnv()).toBe("timetrack");
  });

  it("klienten falder tilbage til env, når scriptet ikke er indlæst", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://build.example");
    vi.stubGlobal("window", {});
    expect(appUrlEnv()).toBe("https://build.example");
  });
});

describe("renderRuntimeConfigScript", () => {
  it("serialiserer de tre værdier fra den kørende proces", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://www.example");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    const js = renderRuntimeConfigScript();
    const win: Record<string, unknown> = {};
    new Function("window", js)(win);
    expect(win.__TT_CONFIG__).toEqual({
      appUrl: "https://app.example",
      marketingUrl: "https://www.example",
      brand: "timetrack",
    });
  });

  it("kan ikke afsluttes tidligt af en værdi med </script> eller citationstegn", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", 'https://x.example/"</script>');
    const js = renderRuntimeConfigScript();
    const win: Record<string, unknown> = {};
    new Function("window", js)(win);
    expect((win.__TT_CONFIG__ as { appUrl: string }).appUrl).toBe(
      'https://x.example/"</script>',
    );
    expect(js).not.toContain("</script>");
  });
});

describe("runtimeBuildMismatches", () => {
  it("er tom, når runtime og build er ens (afvigelse kan ikke simuleres: vitest har ingen inlining)", async () => {
    // Build-værdien er inlinet af Next; i vitest er den samme process.env,
    // så en afvigelse kan ikke opstå her. Tom liste når de er ens.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://same.example");
    expect(runtimeBuildMismatches()).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_BRAND", "");
    expect(runtimeBuildMismatches()).toEqual([]);
  });
});
