import { describe, expect, it } from "vitest";
import {
  CLIENT_HEADER,
  CLIENT_TOO_OLD,
  classifyClientHint,
  clientTooOldMessage,
  compareVersions,
  evaluateClientVersion,
  formatClientHeader,
  formatClientHint,
  isGuardedWritePath,
  LEGACY_EXTENSION_VERSION,
  parseClientHeader,
  parseMinClientVersions,
  parseMinClientVersionsDetailed,
  parseVersion,
  resolveRequestClient,
} from "../index";

function headers(init: Record<string, string>): Pick<Headers, "get"> {
  const h = new Headers(init);
  return { get: (k: string) => h.get(k) };
}

describe("parseClientHeader", () => {
  it("læser kind/version", () => {
    expect(parseClientHeader("extension/2.5.2")).toEqual({
      kind: "extension",
      version: "2.5.2",
    });
    expect(parseClientHeader("mobile/1.0.0+5")).toEqual({
      kind: "mobile",
      version: "1.0.0+5",
    });
    expect(parseClientHeader(" Web/abc123def456 ")).toEqual({
      kind: "web",
      version: "abc123def456",
    });
  });

  it("afviser ukendte typer og skrald", () => {
    expect(parseClientHeader(null)).toBeNull();
    expect(parseClientHeader("")).toBeNull();
    expect(parseClientHeader("toaster/1.0")).toBeNull();
    expect(parseClientHeader("extension")).toBeNull();
    expect(parseClientHeader("extension/")).toBeNull();
    expect(parseClientHeader("extension/2.5.2; drop table")).toBeNull();
    expect(parseClientHeader(`extension/${"9".repeat(40)}`)).toBeNull();
  });

  it("formatClientHeader er den omvendte", () => {
    expect(formatClientHeader("extension", "2.5.2")).toBe("extension/2.5.2");
    expect(parseClientHeader(formatClientHeader("pwa", "0.1.0+abc"))).toEqual({
      kind: "pwa",
      version: "0.1.0+abc",
    });
  });
});

describe("parseVersion / compareVersions", () => {
  it("parser semver med valgfrit numerisk build", () => {
    expect(parseVersion("2.5.1")).toEqual({
      parts: [2, 5, 1, 0],
      build: null,
    });
    expect(parseVersion("1.0.0+5")).toEqual({ parts: [1, 0, 0, 0], build: 5 });
    expect(parseVersion("0.2")).toEqual({ parts: [0, 2, 0, 0], build: null });
    // Chrome tillader fire dele (2.5.2.1)
    expect(parseVersion("2.5.2.1")).toEqual({
      parts: [2, 5, 2, 1],
      build: null,
    });
    // Ikke-numerisk build (web: git-SHA) ignoreres
    expect(parseVersion("0.1.0+abc1234")).toEqual({
      parts: [0, 1, 0, 0],
      build: null,
    });
    expect(parseVersion("abc1234")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("sammenligner numerisk, ikke leksikalsk", () => {
    expect(compareVersions("2.5.10", "2.5.9")).toBe(1);
    expect(compareVersions("2.5.0", "2.5.1")).toBe(-1);
    expect(compareVersions("2.5.1", "2.5.1")).toBe(0);
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
  });

  it("fjerde del tæller efter de tre første", () => {
    expect(compareVersions("2.5.2.1", "2.5.2")).toBe(1);
    expect(compareVersions("2.5.1.9", "2.5.2")).toBe(-1);
    expect(compareVersions("2.5.2", "2.5.2.1")).toBe(-1);
  });

  it("build tæller kun når minimum har et build", () => {
    expect(compareVersions("1.0.0+4", "1.0.0+5")).toBe(-1);
    expect(compareVersions("1.0.0+5", "1.0.0+5")).toBe(0);
    // Mangler klientens build, kan samme version ikke afgøres → ukendt
    expect(compareVersions("1.0.0", "1.0.0+5")).toBeNull();
    expect(compareVersions("0.9.0", "1.0.0+5")).toBe(-1);
    expect(compareVersions("1.0.1", "1.0.0+5")).toBe(1);
    expect(compareVersions("1.0.0+3", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1+1", "1.0.0+5")).toBe(1);
  });

  it("returnerer null når en side ikke kan sammenlignes", () => {
    expect(compareVersions("abc1234", "2.5.1")).toBeNull();
    expect(compareVersions("2.5.1", "nope")).toBeNull();
  });
});

describe("parseMinClientVersions", () => {
  it("tom/udefineret = ingen håndhævelse", () => {
    expect(parseMinClientVersions(undefined)).toEqual({});
    expect(parseMinClientVersions("")).toEqual({});
    expect(parseMinClientVersions("   ")).toEqual({});
  });

  it("læser kommaseparerede par og springer ugyldige over", () => {
    expect(
      parseMinClientVersions(
        "extension=2.5.1, mobile=1.0.0+5,desktop=0.2.21,toaster=1.0,web=,api=abc",
      ),
    ).toEqual({
      extension: "2.5.1",
      mobile: "1.0.0+5",
      desktop: "0.2.21",
    });
  });

  it("rapporterer ugyldige poster", () => {
    expect(
      parseMinClientVersionsDetailed("extension=2.5.2,toaster=1,mobile=x"),
    ).toEqual({
      minimums: { extension: "2.5.2" },
      invalid: ["toaster=1", "mobile=x"],
    });
  });
});

describe("resolveRequestClient", () => {
  it("bruger headeren når den findes", () => {
    expect(
      resolveRequestClient(headers({ [CLIENT_HEADER]: "extension/2.5.2" })),
    ).toEqual({ kind: "extension", version: "2.5.2", declared: true });
  });

  it("extension-origin uden header på extension.* = legacy-extension (≤ 2.5.1)", () => {
    expect(
      resolveRequestClient(
        headers({ origin: "chrome-extension://abcdefghijklmnop" }),
        "extension.updateTimerState",
      ),
    ).toEqual({
      kind: "extension",
      version: LEGACY_EXTENSION_VERSION,
      declared: false,
    });
  });

  it("extension-origin uden header uden for extension.* = ukendt", () => {
    const h = headers({ origin: "chrome-extension://abc" });
    expect(resolveRequestClient(h, "time.create").kind).toBeNull();
    expect(resolveRequestClient(h).kind).toBeNull();
  });

  it("uden header og uden extension-origin = ukendt", () => {
    expect(resolveRequestClient(headers({ "user-agent": "curl/8" }))).toEqual({
      kind: null,
      version: null,
      declared: false,
    });
    expect(resolveRequestClient(null)).toEqual({
      kind: null,
      version: null,
      declared: false,
    });
  });

  it("ugyldig header falder tilbage til origin-gæt", () => {
    expect(
      resolveRequestClient(
        headers({
          [CLIENT_HEADER]: "skrald",
          origin: "moz-extension://x",
        }),
        "extension.quickStop",
      ).kind,
    ).toBe("extension");
  });
});

describe("isGuardedWritePath", () => {
  it("timer- og tidsskrivninger er beskyttet", () => {
    for (const p of [
      "timerSync.sync",
      "timerSync.confirmStop",
      "timerSync.clear",
      "extension.updateTimerState",
      "extension.quickStop",
      "extension.createTimeEntry",
      "time.create",
      "time.update",
      "time.delete",
      "time.bulkDelete",
    ]) {
      expect(isGuardedWritePath(p, "mutation")).toBe(true);
    }
  });

  it("læsninger, login og andre routere er fri", () => {
    expect(isGuardedWritePath("timerSync.get", "query")).toBe(false);
    expect(isGuardedWritePath("time.list", "query")).toBe(false);
    expect(isGuardedWritePath("extension.generateToken", "mutation")).toBe(
      false,
    );
    expect(isGuardedWritePath("extension.revokeToken", "mutation")).toBe(false);
    expect(isGuardedWritePath("clients.create", "mutation")).toBe(false);
    expect(isGuardedWritePath("timeline.create", "mutation")).toBe(false);
  });
});

describe("evaluateClientVersion", () => {
  const mins = { extension: "2.5.2", mobile: "1.0.0+5" };

  it("for gammel extension afvises", () => {
    expect(
      evaluateClientVersion(
        { kind: "extension", version: "2.5.0", declared: true },
        mins,
      ),
    ).toEqual({ status: "too_old", kind: "extension", minimum: "2.5.2" });
  });

  it("legacy-extension uden header afvises når minimum > 2.5.1", () => {
    expect(
      evaluateClientVersion(
        {
          kind: "extension",
          version: LEGACY_EXTENSION_VERSION,
          declared: false,
        },
        mins,
      ).status,
    ).toBe("too_old");
    expect(
      evaluateClientVersion(
        {
          kind: "extension",
          version: LEGACY_EXTENSION_VERSION,
          declared: false,
        },
        { extension: "2.5.1" },
      ).status,
    ).toBe("ok");
  });

  it("ny nok, ukendt og ikke-konfigureret er tilladt", () => {
    expect(
      evaluateClientVersion(
        { kind: "extension", version: "2.5.2", declared: true },
        mins,
      ).status,
    ).toBe("ok");
    expect(
      evaluateClientVersion(
        { kind: null, version: null, declared: false },
        mins,
      ).status,
    ).toBe("unknown");
    expect(
      evaluateClientVersion(
        { kind: "desktop", version: "0.0.1", declared: true },
        mins,
      ).status,
    ).toBe("ok");
    // Web-SHA kan ikke sammenlignes → tilladt
    expect(
      evaluateClientVersion(
        { kind: "web", version: "abc1234", declared: true },
        { web: "1.0.0" },
      ).status,
    ).toBe("unknown");
  });

  it("mobil uden build-nummer på samme version er ukendt (tilladt)", () => {
    expect(
      evaluateClientVersion(
        { kind: "mobile", version: "1.0.0", declared: true },
        mins,
      ).status,
    ).toBe("unknown");
    expect(
      evaluateClientVersion(
        { kind: "mobile", version: "0.9.0", declared: true },
        mins,
      ).status,
    ).toBe("too_old");
  });

  it("intet minimum = aldrig afvisning", () => {
    expect(
      evaluateClientVersion(
        { kind: "extension", version: "0.0.1", declared: true },
        {},
      ).status,
    ).toBe("ok");
  });
});

describe("clientTooOldMessage", () => {
  it("dansk tekst pr. klienttype", () => {
    expect(clientTooOldMessage("extension")).toBe(
      "Din TimeTrack-udvidelse er for gammel — opdatér for at fortsætte",
    );
    expect(clientTooOldMessage("mobile")).toBe(
      "Din TimeTrack-app er for gammel — opdatér for at fortsætte",
    );
    expect(CLIENT_TOO_OLD).toBe("CLIENT_TOO_OLD");
  });
});

describe("formatClientHint / classifyClientHint", () => {
  it("header-hint har kind@version og den grove familie", () => {
    expect(
      formatClientHint(
        { kind: "extension", version: "2.5.2", declared: true },
        "extension/chrome",
      ),
    ).toBe("extension@2.5.2 extension/chrome");
    expect(
      formatClientHint(
        { kind: "web", version: "0.1.0+abc1234def", declared: true },
        "chrome/windows",
      ),
    ).toBe("web@0.1.0+abc1234def chrome/windows");
  });

  it("uden header bevares det gamle hint uændret", () => {
    expect(
      formatClientHint(
        { kind: "extension", version: "2.5.1", declared: false },
        "extension/chrome",
      ),
    ).toBe("extension/chrome");
    expect(
      formatClientHint({ kind: null, version: null, declared: false }, null),
    ).toBeNull();
  });

  it("holder sig under 64 tegn", () => {
    const hint = formatClientHint(
      { kind: "desktop", version: "1".repeat(32), declared: true },
      "desktop-electron/windows",
    );
    expect(hint?.length).toBeLessThanOrEqual(64);
  });

  it("klassificerer hints til fordelingen", () => {
    expect(classifyClientHint("extension@2.5.2 extension/chrome")).toEqual({
      kind: "extension",
      version: "2.5.2",
    });
    expect(classifyClientHint("extension/chrome")).toEqual({
      kind: "extension",
      version: null,
    });
    expect(classifyClientHint("mobilapp/ios")).toEqual({
      kind: "mobile",
      version: null,
    });
    expect(classifyClientHint("desktop-tauri/mac")).toEqual({
      kind: "desktop",
      version: null,
    });
    expect(classifyClientHint("chrome/windows")).toEqual({
      kind: null,
      version: null,
    });
    expect(classifyClientHint(null)).toEqual({ kind: null, version: null });
  });
});
