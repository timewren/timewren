import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/schema", () => ({
  imports: { status: "status", updatedAt: "updated_at" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ and: c }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
  sql: () => ({ sql: true }),
}));

const {
  ACTIVE_IMPORT_STATUSES,
  CANCELLABLE_IMPORT_STATUSES,
  STALE_PROCESSING_MS,
  failStaleProcessingImports,
} = await import("@/lib/imports/status");

// Cron-importen sætter rækken til "processing", mens den arbejder. Den
// status skal tælle som aktiv og kunne annulleres, og en række der hænger
// i "processing" (fx efter et deploy midt i kørslen) skal ikke stå for evigt.

describe("import-statusser", () => {
  it("regner processing som en aktiv import", () => {
    expect(ACTIVE_IMPORT_STATUSES).toContain("processing");
    expect(ACTIVE_IMPORT_STATUSES).toContain("running");
  });

  it("kan annullere en import der er i processing", () => {
    expect(CANCELLABLE_IMPORT_STATUSES).toContain("processing");
    expect(CANCELLABLE_IMPORT_STATUSES).toContain("running");
  });
});

describe("failStaleProcessingImports", () => {
  it("markerer processing-rækker uden fremskridt i 30 min som failed", async () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    let setArgs: Record<string, unknown> | undefined;
    let whereArgs: unknown;
    const db = {
      update: () => ({
        set: (args: Record<string, unknown>) => {
          setArgs = args;
          return {
            where: (w: unknown) => {
              whereArgs = w;
              return { returning: async () => [{ id: "a" }, { id: "b" }] };
            },
          };
        },
      }),
    };

    const n = await failStaleProcessingImports(db as never, now);

    expect(n).toBe(2);
    expect(STALE_PROCESSING_MS).toBe(30 * 60 * 1000);
    expect(setArgs?.status).toBe("failed");
    expect(setArgs?.completedAt).toEqual(now);
    expect(setArgs?.credentials).toBeNull();
    expect(whereArgs).toEqual({
      and: [
        { eq: ["status", "processing"] },
        { lt: ["updated_at", new Date(now.getTime() - 30 * 60 * 1000)] },
      ],
    });
  });
});
