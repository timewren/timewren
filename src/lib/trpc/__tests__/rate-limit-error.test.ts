import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import type { TRPCError } from "@trpc/server";
import { RateLimitError } from "@/lib/utils/rate-limiter";
import { publicProcedure, router } from "../trpc";

// En overskredet rate limit er en forventet brugerfejl: 429, ikke 500, og
// derfor ikke en Sentry-fejl (TIMETRACK-28, publicPortal.validateToken).
const testRouter = router({
  limited: publicProcedure.mutation(() => {
    throw new RateLimitError(
      "For mange forespørgsler. Prøv igen om 426 sekunder.",
      426_000,
    );
  }),
  // Turbopack kan duplikere klassen på tværs af chunks; navnet skal række.
  limitedOtherChunk: publicProcedure.mutation(() => {
    const err = new Error("For mange forespørgsler.");
    err.name = "RateLimitError";
    throw err;
  }),
  broken: publicProcedure.mutation(() => {
    throw new Error("boom");
  }),
});

const caller = testRouter.createCaller({
  session: null,
  db: {} as never,
  headers: null,
});

async function errorOf(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected rejection");
}

describe("RateLimitError i tRPC", () => {
  it("bliver TOO_MANY_REQUESTS med beskeden bevaret", async () => {
    const err = await errorOf(caller.limited());
    expect(err.code).toBe("TOO_MANY_REQUESTS");
    expect(err.message).toBe(
      "For mange forespørgsler. Prøv igen om 426 sekunder.",
    );
  });

  it("genkendes også på navnet", async () => {
    expect((await errorOf(caller.limitedOtherChunk())).code).toBe(
      "TOO_MANY_REQUESTS",
    );
  });

  it("lader andre fejl være interne serverfejl", async () => {
    expect((await errorOf(caller.broken())).code).toBe("INTERNAL_SERVER_ERROR");
  });
});
