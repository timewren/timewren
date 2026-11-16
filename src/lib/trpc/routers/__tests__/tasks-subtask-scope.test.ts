import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

// createSubtask slår forælderen op via modul-`db`; middlewaren bruger ctx.db.
const mocks = vi.hoisted(() => ({
  findTask: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: { tasks: { findFirst: mocks.findTask } },
    insert: mocks.insert,
  },
}));
vi.mock("@/lib/notifications/push", () => ({ pushToUser: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

import { tasksRouter } from "@/lib/trpc/routers/tasks";
import { router } from "@/lib/trpc/trpc";
import { BL_USER_ID, makeTimeDb } from "@/test/billed-entry-mocks";

const PARENT_ID = "66666666-6666-4666-8666-666666666666";
const dialect = new PgDialect();

/**
 * En bruger, der også er (eller var) medlem af en anden org, må ikke lægge en
 * underopgave i den aktive org under sin opgave fra den anden org: den kopierer
 * forælderens projekt og kunde, som tasks.getById så viser i den aktive org.
 */
describe("tasks.createSubtask scoper forælderen til den aktive org", () => {
  it("slår forælderen op med org-betingelsen", async () => {
    // Mock-db'en: owner i "bl-org". Forælderen findes ikke i den org.
    mocks.findTask.mockResolvedValue(undefined);
    const { db } = makeTimeDb([]);
    const caller = router({ tasks: tasksRouter }).createCaller({
      session: { user: { id: BL_USER_ID, email: "bl@test.local" } },
      db,
      headers: null,
    } as never);

    const err = await caller.tasks
      .createSubtask({ parentTaskId: PARENT_ID, title: "Underopgave" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect(mocks.insert).not.toHaveBeenCalled();
    const where = mocks.findTask.mock.calls[0]?.[0]?.where as SQL;
    expect(dialect.sqlToQuery(where).params).toContain("bl-org");
  });
});
