import { afterEach, describe, expect, it, vi } from "vitest";

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
import { publicProcedure, router } from "../trpc";

// Stien afgør spærringen (src/lib/demo/blocked.ts): apiKeys.create er spærret
// i demoen, clients.list er ikke.
const handler = vi.fn(() => "ok");
const testRouter = router({
  apiKeys: router({ create: publicProcedure.mutation(handler) }),
  clients: router({ list: publicProcedure.query(handler) }),
});
const caller = testRouter.createCaller({
  session: null,
  db: {} as never,
  headers: null,
});

afterEach(() => {
  vi.unstubAllEnvs();
  handler.mockClear();
});

describe("demo-spærring i tRPC (DEMO_MODE=1)", () => {
  it("svarer FORBIDDEN med en venlig besked og kører ikke proceduren", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const err = (await caller.apiKeys
      .create()
      .catch((e: unknown) => e)) as TRPCError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Det er ikke muligt i demoen.");
    expect(handler).not.toHaveBeenCalled();
  });

  it("lader alt andet køre i demoen", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(await caller.clients.list()).toBe("ok");
  });

  it("er en no-op uden DEMO_MODE", async () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(await caller.apiKeys.create()).toBe("ok");
  });
});
