import { describe, expect, it, vi } from "vitest";
import {
  buildTimerEventRow,
  classifyTimerWrite,
  clientHintFromHeaders,
  logTimerEvent,
  resolveTimerEventSource,
  type TimerSnapshot,
} from "../events";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";
const START = new Date("2026-10-01T08:00:00Z");

function snap(over: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    isRunning: false,
    startTime: null,
    elapsedSeconds: 0,
    baseSeconds: 0,
    projectId: null,
    clientId: null,
    ...over,
  };
}

const running = snap({
  isRunning: true,
  startTime: START,
  projectId: P1,
  clientId: C1,
});

describe("classifyTimerWrite", () => {
  it("start på en ryddet række er start", () => {
    expect(classifyTimerWrite(snap(), running)).toBe("start");
  });

  it("start uden forudgående række er start", () => {
    expect(classifyTimerWrite(null, running)).toBe("start");
  });

  it("genoptag med basetid er resume", () => {
    const paused = snap({
      elapsedSeconds: 600,
      baseSeconds: 600,
      projectId: P1,
    });
    expect(classifyTimerWrite(paused, { ...running, baseSeconds: 600 })).toBe(
      "resume",
    );
  });

  it("uændret heartbeat logges ikke", () => {
    expect(
      classifyTimerWrite(running, { ...running, elapsedSeconds: 120 }),
    ).toBeNull();
  });

  it("heartbeat med lille urforskel logges ikke", () => {
    expect(
      classifyTimerWrite(running, {
        ...running,
        startTime: new Date(START.getTime() + 30_000),
      }),
    ).toBeNull();
  });

  it("kundeskift på kørende timer er client_change", () => {
    expect(classifyTimerWrite(running, { ...running, clientId: C2 })).toBe(
      "client_change",
    );
    expect(classifyTimerWrite(running, { ...running, projectId: P2 })).toBe(
      "client_change",
    );
  });

  it("spring i starttid er time_change", () => {
    expect(
      classifyTimerWrite(running, {
        ...running,
        startTime: new Date(START.getTime() - 45 * 60_000),
      }),
    ).toBe("time_change");
  });

  it("spring i basetid er time_change", () => {
    expect(classifyTimerWrite(running, { ...running, baseSeconds: 3600 })).toBe(
      "time_change",
    );
  });

  it("kørende → ikke-kørende med tid er pause", () => {
    expect(
      classifyTimerWrite(
        running,
        snap({
          elapsedSeconds: 900,
          baseSeconds: 900,
          projectId: P1,
          clientId: C1,
        }),
      ),
    ).toBe("pause");
  });

  it("pause efter 0 sekunder (beholder projekt) er pause, ikke clear", () => {
    expect(
      classifyTimerWrite(running, snap({ projectId: P1, clientId: C1 })),
    ).toBe("pause");
  });

  it("nulstilling af en aktiv række er clear", () => {
    expect(classifyTimerWrite(running, snap())).toBe("clear");
    expect(
      classifyTimerWrite(snap({ elapsedSeconds: 60, baseSeconds: 60 }), snap()),
    ).toBe("clear");
  });

  it("nulstilling af en allerede ryddet række logges ikke", () => {
    expect(classifyTimerWrite(snap(), snap())).toBeNull();
  });

  it("kundeskift på pauset timer er client_change", () => {
    const paused = snap({ elapsedSeconds: 60, baseSeconds: 60, clientId: C1 });
    expect(classifyTimerWrite(paused, { ...paused, clientId: C2 })).toBe(
      "client_change",
    );
  });
});

describe("clientHintFromHeaders", () => {
  const h = (values: Record<string, string>) =>
    new Headers(values) as Pick<Headers, "get">;

  it("genkender extension-origin", () => {
    expect(clientHintFromHeaders(h({ origin: "chrome-extension://abc" }))).toBe(
      "extension/chrome",
    );
  });

  it("giver kun browserfamilie og OS — ingen versioner", () => {
    const hint = clientHintFromHeaders(
      h({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      }),
    );
    expect(hint).toBe("chrome/windows");
  });

  it("skelner Edge og Safari", () => {
    expect(
      clientHintFromHeaders(
        h({
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0",
        }),
      ),
    ).toBe("edge/windows");
    expect(
      clientHintFromHeaders(
        h({
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        }),
      ),
    ).toBe("safari/mac");
  });

  it("genkender mobilappen", () => {
    expect(clientHintFromHeaders(h({ "user-agent": "okhttp/4.12.0" }))).toBe(
      "mobilapp/ukendt",
    );
    expect(
      clientHintFromHeaders(
        h({ "user-agent": "TimeTrack/1 CFNetwork/1490 Darwin/23.0.0" }),
      ),
    ).toBe("mobilapp/ios");
  });

  it("foranstiller TimeTrack-klientens type og version fra headeren", () => {
    expect(
      clientHintFromHeaders(
        h({
          "x-timetrack-client": "extension/2.5.2",
          origin: "chrome-extension://abc",
        }),
      ),
    ).toBe("extension@2.5.2 extension/chrome");
    expect(
      clientHintFromHeaders(
        h({ "x-timetrack-client": "mobile/1.0.0+5", "user-agent": "okhttp/4" }),
      ),
    ).toBe("mobile@1.0.0+5 mobilapp/ukendt");
  });

  it("ugyldig header ignoreres", () => {
    expect(
      clientHintFromHeaders(
        h({ "x-timetrack-client": "toaster/1", "user-agent": "curl/8" }),
      ),
    ).toBe("script/ukendt");
  });

  it("uden headers er hint null", () => {
    expect(clientHintFromHeaders(null)).toBeNull();
    expect(clientHintFromHeaders(h({}))).toBeNull();
  });
});

describe("resolveTimerEventSource", () => {
  it("mobilappen sender source=web men logges som mobile", () => {
    expect(resolveTimerEventSource("web", "mobilapp/ios")).toBe("mobile");
  });
  it("respekterer erklæret extension", () => {
    expect(resolveTimerEventSource("extension", "extension/chrome")).toBe(
      "extension",
    );
  });
  it("header-hints for mobil og desktop afgør kilden", () => {
    expect(resolveTimerEventSource("web", "mobile@1.0.0+5")).toBe("mobile");
    expect(resolveTimerEventSource(undefined, "desktop@0.2.21")).toBe(
      "desktop",
    );
  });
  it("ukendt kilde falder tilbage til web", () => {
    expect(resolveTimerEventSource(undefined, "chrome/mac")).toBe("web");
  });
});

describe("buildTimerEventRow", () => {
  it("klipper hint og fjerner udefinerede detail-felter", () => {
    const row = buildTimerEventRow({
      userId: "u1",
      event: "start",
      source: "web",
      clientHint: "x".repeat(200),
      detail: { reason: "ok", gone: undefined },
    });
    expect(row.clientHint).toHaveLength(64);
    expect(row.detail).toEqual({ reason: "ok" });
    expect(row.organizationId).toBeNull();
  });

  it("erstatter for stor detail med et resumé", () => {
    const row = buildTimerEventRow({
      userId: "u1",
      event: "start",
      source: "web",
      detail: { big: "y".repeat(5000) },
    });
    expect(row.detail).toEqual({ truncated: true, keys: ["big"] });
  });

  it("tom detail bliver null og ugyldig starttid bliver null", () => {
    const row = buildTimerEventRow({
      userId: "u1",
      event: "clear",
      source: "cron",
      detail: {},
      startTime: new Date("ugyldig"),
    });
    expect(row.detail).toBeNull();
    expect(row.startTime).toBeNull();
  });
});

describe("logTimerEvent", () => {
  it("kaster aldrig, selv når insert fejler", async () => {
    const values = vi.fn().mockRejectedValue(new Error("db nede"));
    const fakeDb = { insert: vi.fn(() => ({ values })) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      logTimerEvent(fakeDb as never, {
        userId: "u1",
        event: "start",
        source: "web",
      }),
    ).resolves.toBeUndefined();
    expect(values).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("indsætter den byggede række", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const fakeDb = { insert: vi.fn(() => ({ values })) };
    await logTimerEvent(fakeDb as never, {
      userId: "u1",
      organizationId: "o1",
      event: "claim_stop",
      source: "extension",
      versionBefore: 4,
      versionAfter: 5,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        organizationId: "o1",
        event: "claim_stop",
        source: "extension",
        versionBefore: 4,
        versionAfter: 5,
      }),
    );
  });
});
