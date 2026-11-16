import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/email-classifier", () => ({
  updateClassificationCache: vi.fn(),
}));

import { emailTasksRouter } from "@/lib/trpc/routers/emailTasks";
import { router } from "@/lib/trpc/trpc";
import { BL_USER_ID, makeTimeDb } from "@/test/billed-entry-mocks";

/** En kunde i en anden organisation (findes ikke i kalderens kunder). */
const FOREIGN_CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const TASK_ID = "55555555-5555-4555-8555-555555555555";

const testRouter = router({ emailTasks: emailTasksRouter });

describe("emailTasks.updateCustomerMatch scoper clientId", () => {
  it("afviser en kunde uden for kalderens organisation", async () => {
    // Mock-db'en: owner i "bl-org", ingen kunder (tomme tabeller).
    const { db } = makeTimeDb([]);
    const caller = testRouter.createCaller({
      session: { user: { id: BL_USER_ID, email: "bl@test.local" } },
      db,
      headers: null,
    } as never);

    const err = await caller.emailTasks
      .updateCustomerMatch({ taskId: TASK_ID, clientId: FOREIGN_CLIENT_ID })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(db.update).not.toHaveBeenCalled();
  });
});
