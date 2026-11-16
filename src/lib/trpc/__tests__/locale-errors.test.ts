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

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { st } from "@/i18n/sync-text";
import { publicProcedure, router } from "../trpc";

const testRouter = router({
  validated: publicProcedure
    .input(
      z.object({
        name: z.string().min(2, { error: () => st("zod.nameMin2") }),
      }),
    )
    .query(({ input }) => input.name),
  forbidden: publicProcedure.query(() => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: st("errors.accessDenied"),
    });
  }),
});

function caller(headers: Headers | null) {
  return testRouter.createCaller({ session: null, db: {} as never, headers });
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("tRPC-fejl på brugerens sprog", () => {
  it("zod-beskeder er danske uden sprog og følger cookie ellers", async () => {
    expect(await messageOf(caller(null).validated({ name: "a" }))).toContain(
      "Navn skal være mindst 2 tegn",
    );
    const en = new Headers({ cookie: "locale=en" });
    expect(await messageOf(caller(en).validated({ name: "a" }))).toContain(
      "Name must be at least 2 characters",
    );
    const de = new Headers({ "accept-language": "de-DE,de;q=0.9" });
    expect(await messageOf(caller(de).validated({ name: "a" }))).toContain(
      "Der Name muss mindestens 2 Zeichen lang sein",
    );
  });

  it("bevidste TRPCError-tekster oversættes inde i proceduren", async () => {
    expect(await messageOf(caller(null).forbidden())).toBe(
      "Du har ikke adgang til denne ressource",
    );
    const es = new Headers({ cookie: "locale=es" });
    expect(await messageOf(caller(es).forbidden())).toBe(
      "No tienes acceso a este recurso",
    );
  });
});
