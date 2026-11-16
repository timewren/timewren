import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { extensionRouter } from "@/lib/trpc/routers/extension";
import { router } from "@/lib/trpc/trpc";

/** Et projekt i en anden organisation (findes ikke i kalderens projekter). */
const FOREIGN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";

function makeDb() {
  const query = new Proxy(
    {
      extensionTokens: {
        findFirst: async () => ({
          id: "ext-token-1",
          userId: "ext-user",
          usageCount: 0,
          expiresAt: null,
        }),
      },
      members: {
        findMany: async () => [{ organizationId: "org-a", role: "owner" }],
      },
    } as Record<string, unknown>,
    {
      // Øvrige tabeller (bl.a. projects) svarer tomt.
      get: (target, key: string) =>
        target[key] ?? {
          findFirst: async () => undefined,
          findMany: async () => [],
        },
    },
  );
  return {
    query,
    update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    select: vi.fn(() => ({
      from: () => ({ where: async () => [{ maxPos: 0 }] }),
    })),
    insert: vi.fn(() => ({
      values: () => ({ returning: async () => [{ id: "new-task" }] }),
    })),
  };
}

const testRouter = router({ extension: extensionRouter });

describe("extension.createTask scoper projectId", () => {
  it("afviser et projekt uden for tokenets organisation", async () => {
    const db = makeDb();
    const caller = testRouter.createCaller({
      session: null,
      db,
      headers: null,
    } as never);

    const err = await caller.extension
      .createTask({
        token: "tt_ext_test",
        title: "Opgave fra Gmail",
        projectId: FOREIGN_PROJECT_ID,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(db.insert).not.toHaveBeenCalled();
  });
});
