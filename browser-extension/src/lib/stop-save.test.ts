import { describe, expect, it } from "vitest";
import { ApiError, isDefiniteRejection } from "./api-error";
import {
  confirmBlockedByPairedSave,
  isNotYetDue,
  saveWithRetry,
  serverHasActiveSession,
  suggestionMayRelabel,
  confirmWaitsForPairedSave as waits,
} from "./stop-save";

const noSleep = async () => {};

describe("isDefiniteRejection", () => {
  it("timeout er IKKE en afvisning — serveren kan have gemt posten", () => {
    expect(
      isDefiniteRejection(
        new ApiError("Forbindelsen tog for lang tid", "timeout"),
      ),
    ).toBe(false);
  });

  it("5xx og 502/504 fra proxyen er usikre", () => {
    expect(isDefiniteRejection(new ApiError("x", "http", 500))).toBe(false);
    expect(isDefiniteRejection(new ApiError("x", "http", 504))).toBe(false);
  });

  it("408 og 429 er usikre/forbigående", () => {
    expect(isDefiniteRejection(new ApiError("x", "http", 408))).toBe(false);
    expect(isDefiniteRejection(new ApiError("x", "http", 429))).toBe(false);
  });

  it("400/404 er en sikker afvisning", () => {
    expect(isDefiniteRejection(new ApiError("x", "http", 400))).toBe(true);
    expect(isDefiniteRejection(new ApiError("x", "http", 404))).toBe(true);
  });

  it("ukendte fejl (TypeError, SyntaxError) er usikre", () => {
    expect(isDefiniteRejection(new TypeError("Failed to fetch"))).toBe(false);
    expect(isDefiniteRejection(new Error("Uventet svar"))).toBe(false);
  });
});

describe("saveWithRetry", () => {
  it("timeout hvor serveren faktisk gemte: nyt forsøg med SAMME clientEntryId giver én post", async () => {
    // Fake server, idempotent på clientEntryId som prod.
    const rows = new Map<string, number>();
    const entry = { clientEntryId: "abc", hours: 0.52 };
    let calls = 0;
    const save = async () => {
      calls++;
      if (!rows.has(entry.clientEntryId)) rows.set(entry.clientEntryId, 1);
      if (calls === 1) {
        // Serveren committede, men svaret nåede ikke frem inden for 8 s
        throw new ApiError("Forbindelsen tog for lang tid", "timeout");
      }
      return { id: entry.clientEntryId };
    };

    const outcome = await saveWithRetry(save, { sleep: noSleep });

    expect(outcome.status).toBe("saved");
    expect(calls).toBe(2);
    expect(rows.size).toBe(1);
  });

  it("4xx stopper straks som rejected — ingen gentagelser", async () => {
    let calls = 0;
    const outcome = await saveWithRetry(
      async () => {
        calls++;
        throw new ApiError("Projekt ikke fundet", "http", 404);
      },
      { sleep: noSleep },
    );
    expect(outcome.status).toBe("rejected");
    expect(calls).toBe(1);
  });

  it("vedvarende timeout ender som unconfirmed — aldrig rejected", async () => {
    let calls = 0;
    const seen: number[] = [];
    const outcome = await saveWithRetry(
      async () => {
        calls++;
        throw new ApiError("Forbindelsen tog for lang tid", "timeout");
      },
      { sleep: noSleep, onUncertainFailure: (_e, n) => seen.push(n) },
    );
    expect(outcome.status).toBe("unconfirmed");
    expect(calls).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("venter mellem forsøgene med de angivne pauser", async () => {
    const slept: number[] = [];
    await saveWithRetry(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      {
        delaysMs: [10, 20],
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );
    expect(slept).toEqual([10, 20]);
  });
});

describe("isNotYetDue", () => {
  const now = new Date("2026-10-02T10:00:00Z").getTime();
  it("post uden notBefore er klar", () => {
    expect(isNotYetDue({}, now)).toBe(false);
  });
  it("write-ahead-post venter til fristen", () => {
    expect(isNotYetDue({ notBefore: "2026-10-02T10:01:00Z" }, now)).toBe(true);
    expect(isNotYetDue({ notBefore: "2026-10-02T09:59:00Z" }, now)).toBe(false);
  });
  it("ugyldig dato blokerer ikke køen", () => {
    expect(isNotYetDue({ notBefore: "nonsens" }, now)).toBe(false);
  });
});

describe("suggestionMayRelabel", () => {
  it("lige startet timer må rettes af et forslag", () => {
    expect(suggestionMayRelabel(0)).toBe(true);
    expect(suggestionMayRelabel(45)).toBe(true);
  });
  it("timer med mere end et minut flyttes aldrig af et forslag", () => {
    expect(suggestionMayRelabel(61)).toBe(false);
    expect(suggestionMayRelabel(31 * 60)).toBe(false);
  });
});

describe("serverHasActiveSession", () => {
  it("kørende timer fra en anden instans må ikke overskrives", () => {
    expect(serverHasActiveSession({ isRunning: true, baseSeconds: 0 })).toBe(
      true,
    );
  });
  it("pauset tid fra en anden instans må ikke overskrives", () => {
    expect(serverHasActiveSession({ isRunning: false, baseSeconds: 900 })).toBe(
      true,
    );
  });
  it("tom række er fri", () => {
    expect(
      serverHasActiveSession({
        isRunning: false,
        baseSeconds: 0,
        elapsedSeconds: 0,
      }),
    ).toBe(false);
    expect(serverHasActiveSession(null)).toBe(false);
  });
  it("en andens række midt i et stop overskrives ikke — den kan være eneste kopi", () => {
    expect(
      serverHasActiveSession({
        isRunning: true,
        intent: "stopping",
        version: 8,
      }),
    ).toBe(true);
  });
  it("eget efterladt stop (bekræftelsen ligger i vores kø) blokerer ikke", () => {
    expect(
      serverHasActiveSession(
        { isRunning: true, intent: "stopping", version: 8 },
        [8],
      ),
    ).toBe(false);
  });
});

describe("saveWithRetry — 4xx efter et usikkert forsøg", () => {
  it("klassificeres som unconfirmed, ikke rejected (første forsøg kan være gemt)", async () => {
    let calls = 0;
    const outcome = await saveWithRetry(
      async () => {
        calls++;
        if (calls === 1) throw new ApiError("timeout", "timeout");
        throw new ApiError("Ugyldig forespørgsel", "http", 400);
      },
      { sleep: noSleep },
    );
    expect(outcome.status).toBe("unconfirmed");
    expect(calls).toBe(2);
  });

  it("kalder onBeforeAttempt før hvert forsøg (forlænger write-ahead-fristen)", async () => {
    const seen: number[] = [];
    await saveWithRetry(
      async () => {
        throw new ApiError("timeout", "timeout");
      },
      { sleep: noSleep, onBeforeAttempt: async (n) => void seen.push(n) },
    );
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("confirmBlockedByPairedSave", () => {
  it("dropper bekræftelsen når det parrede gem er opgivet", () => {
    expect(confirmBlockedByPairedSave({ group: "g1" }, new Set(["g1"]))).toBe(
      true,
    );
  });
  it("uparrede og andre gruppers bekræftelser kører", () => {
    expect(confirmBlockedByPairedSave({}, new Set(["g1"]))).toBe(false);
    expect(confirmBlockedByPairedSave({ group: "g2" }, new Set(["g1"]))).toBe(
      false,
    );
  });
});

describe("serverHasActiveSession — forladt stop (intentAt)", () => {
  const now = new Date("2026-10-02T12:00:00Z").getTime();
  const row = (intentAt: string | null | undefined) => ({
    isRunning: true,
    intent: "stopping",
    version: 8,
    intentAt,
  });
  it("stop ældre end 30 s blokerer ikke (cronen parkerer det)", () => {
    expect(serverHasActiveSession(row("2026-10-02T11:59:20Z"), [], now)).toBe(
      false,
    );
  });
  it("stop yngre end 30 s blokerer", () => {
    expect(serverHasActiveSession(row("2026-10-02T11:59:45Z"), [], now)).toBe(
      true,
    );
  });
  it("uden intentAt (gammel server) blokeres som før", () => {
    expect(serverHasActiveSession(row(undefined), [], now)).toBe(true);
    expect(serverHasActiveSession(row(null), [], now)).toBe(true);
  });
});

describe("confirmWaitsForPairedSave (review P1)", () => {
  it("venter mens det parrede gem ikke er landet", () => {
    expect(waits({ group: "g1" }, new Set(["g1"]))).toBe(true);
  });
  it("afspilles når gemmet er landet, eller uden par", () => {
    expect(waits({ group: "g1" }, new Set())).toBe(false);
    expect(waits({ group: null }, new Set(["g1"]))).toBe(false);
  });
});
