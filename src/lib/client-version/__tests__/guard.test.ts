import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTrpcError } from "@/lib/api/http";
import {
  ClientTooOldError,
  checkRestClientVersion,
  clientTooOldCause,
  clientTooOldRetryAfterSeconds,
  enforceClientVersion,
  LEGACY_RETRY_AFTER_SECONDS,
} from "../guard";
import {
  CLIENT_TOO_OLD,
  minClientVersionsFromEnv,
  parseMinClientVersions,
} from "../index";

function headers(init: Record<string, string>): Pick<Headers, "get"> {
  const h = new Headers(init);
  return { get: (k: string) => h.get(k) };
}

const mins = parseMinClientVersions("extension=2.5.2,mobile=1.0.0+5");

describe("enforceClientVersion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("afviser beskyttet skrivning fra for gammel klient med PRECONDITION_FAILED", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let thrown: unknown;
    try {
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "extension/2.5.0" }),
        path: "extension.updateTimerState",
        type: "mutation",
        minimums: mins,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((thrown as TRPCError).message).toBe(
      "Din TimeTrack-udvidelse er for gammel — opdatér for at fortsætte",
    );
    const cause = clientTooOldCause(thrown);
    expect(cause?.appCode).toBe(CLIENT_TOO_OLD);
    expect(cause?.minimum).toBe("2.5.2");
  });

  it("afviser gammel extension uden header (origin) på extension.*", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      enforceClientVersion({
        headers: headers({ origin: "chrome-extension://abc" }),
        path: "extension.updateTimerState",
        type: "mutation",
        minimums: mins,
      }),
    ).toThrow(TRPCError);
  });

  it("gammel extension uden header får 503 (SERVICE_UNAVAILABLE), så 2.5.1 beholder køen", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let thrown: unknown;
    try {
      enforceClientVersion({
        headers: headers({ origin: "chrome-extension://abc" }),
        path: "extension.createTimeEntry",
        type: "mutation",
        minimums: mins,
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as TRPCError).code).toBe("SERVICE_UNAVAILABLE");
    expect(clientTooOldCause(thrown)?.legacy).toBe(true);
    expect(clientTooOldRetryAfterSeconds([thrown as TRPCError])).toBe(
      LEGACY_RETRY_AFTER_SECONDS,
    );
  });

  it("deklareret for gammel klient beholder PRECONDITION_FAILED uden Retry-After", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let thrown: unknown;
    try {
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "extension/2.5.0" }),
        path: "extension.createTimeEntry",
        type: "mutation",
        minimums: mins,
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(clientTooOldCause(thrown)?.legacy).toBe(false);
    expect(clientTooOldRetryAfterSeconds([thrown as TRPCError])).toBeNull();
  });

  it("gammel extensions confirmStop slipper igennem (afslutter et allerede gemt stop)", () => {
    expect(() =>
      enforceClientVersion({
        headers: headers({ origin: "chrome-extension://abc" }),
        path: "extension.confirmStop",
        type: "mutation",
        minimums: mins,
      }),
    ).not.toThrow();
  });

  it("chrome-extension-origin på REST/API-stier antages ikke at være legacy", () => {
    expect(() =>
      enforceClientVersion({
        headers: headers({ origin: "chrome-extension://abc" }),
        path: "time.create",
        type: "mutation",
        minimums: mins,
      }),
    ).not.toThrow();
  });

  it("læsninger fra for gamle klienter er tilladt", () => {
    const res = enforceClientVersion({
      headers: headers({ "x-timetrack-client": "extension/2.0.0" }),
      path: "extension.getTimerStateWithVersion",
      type: "query",
      minimums: mins,
    });
    expect(res.guarded).toBe(false);
    expect(res.client.kind).toBe("extension");
  });

  it("ukendte klienter (API-nøgle, MCP, script) afvises aldrig", () => {
    const res = enforceClientVersion({
      headers: headers({ authorization: "Bearer tt_x", "user-agent": "curl" }),
      path: "time.create",
      type: "mutation",
      minimums: mins,
    });
    expect(res.guarded).toBe(true);
    expect(res.client.kind).toBeNull();
  });

  it("ny nok klient slipper igennem", () => {
    expect(() =>
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "mobile/1.0.0+5" }),
        path: "timerSync.confirmStop",
        type: "mutation",
        minimums: mins,
      }),
    ).not.toThrow();
  });

  it("uden env håndhæves intet", () => {
    vi.stubEnv("MIN_CLIENT_VERSIONS", "");
    expect(minClientVersionsFromEnv()).toEqual({});
    expect(() =>
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "extension/0.0.1" }),
        path: "time.delete",
        type: "mutation",
      }),
    ).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("observe-tilstand afviser ikke", () => {
    vi.stubEnv("MIN_CLIENT_VERSIONS", "extension=2.5.2");
    vi.stubEnv("MIN_CLIENT_VERSIONS_MODE", "observe");
    expect(() =>
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "extension/2.5.0" }),
        path: "extension.quickStop",
        type: "mutation",
      }),
    ).not.toThrow();
    expect(
      checkRestClientVersion(
        headers({ "x-timetrack-client": "desktop/0.0.1" }),
        { desktop: "0.2.21" },
      ),
    ).toBeNull();
    vi.unstubAllEnvs();
  });

  it("læser minimum fra env", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MIN_CLIENT_VERSIONS", "desktop=0.2.21");
    expect(() =>
      enforceClientVersion({
        headers: headers({ "x-timetrack-client": "desktop/0.2.20" }),
        path: "time.update",
        type: "mutation",
      }),
    ).toThrow(TRPCError);
    vi.unstubAllEnvs();
  });
});

describe("REST", () => {
  afterEach(() => vi.restoreAllMocks());

  it("checkRestClientVersion giver afvisningen for for gammel desktop", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = checkRestClientVersion(
      headers({ "x-timetrack-client": "desktop/0.2.20" }),
      { desktop: "0.2.21" },
    );
    expect(err).toBeInstanceOf(ClientTooOldError);
    expect(
      checkRestClientVersion(headers({}), { desktop: "0.2.21" }),
    ).toBeNull();
  });

  it("handleTrpcError mapper CLIENT_TOO_OLD til HTTP 426", async () => {
    const cause = new ClientTooOldError("api", "1.0.0", "0.9.0");
    const res = handleTrpcError(
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message: cause.message,
        cause,
      }),
    );
    expect(res.status).toBe(426);
    const body = await res.json();
    expect(body.error.code).toBe(CLIENT_TOO_OLD);
    expect(body.error.message).toContain("for gammel");
  });

  it("almindelig PRECONDITION_FAILED er stadig 412", () => {
    const res = handleTrpcError(
      new TRPCError({ code: "PRECONDITION_FAILED", message: "x" }),
    );
    expect(res.status).toBe(412);
  });
});

describe("HTTP-svar via tRPC's fetch-adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  const t = initTRPC.context<{ headers: Headers }>().create();
  const guarded = t.middleware(({ next, ctx, path, type }) => {
    enforceClientVersion({ headers: ctx.headers, path, type, minimums: mins });
    return next();
  });
  const appRouter = t.router({
    extension: t.router({
      createTimeEntry: t.procedure.use(guarded).mutation(() => "ok"),
    }),
  });

  async function call(headersInit: Record<string, string>) {
    const req = new Request("http://x/api/trpc/extension.createTimeEntry", {
      method: "POST",
      headers: { "content-type": "application/json", ...headersInit },
      body: "{}",
    });
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: () => ({ headers: req.headers }),
      responseMeta({ errors }) {
        const retryAfter = clientTooOldRetryAfterSeconds(errors);
        return retryAfter
          ? { headers: new Headers({ "Retry-After": String(retryAfter) }) }
          : {};
      },
    });
  }

  it("extension ≤ 2.5.1 (uden header) får 503 + Retry-After", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call({ origin: "chrome-extension://abc" });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(
      String(LEGACY_RETRY_AFTER_SECONDS),
    );
    const body = await res.json();
    expect(body.error.message).toContain("for gammel");
  });

  it("extension med header under minimum får 412", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call({ "x-timetrack-client": "extension/2.5.0" });
    expect(res.status).toBe(412);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
