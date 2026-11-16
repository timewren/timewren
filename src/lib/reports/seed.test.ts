// src/lib/reports/seed.test.ts
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_TEMPLATES } from "./defaults";
import { seedSystemReportTemplates } from "./seed";

describe("seedSystemReportTemplates", () => {
  it("inserts one row per system template per user, idempotently", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const findMany = vi.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    const db = {
      query: { users: { findMany } },
      insert,
    } as unknown as Parameters<typeof seedSystemReportTemplates>[0];

    await seedSystemReportTemplates(db);

    // 2 users × 2 templates = 4 rows inserted
    expect(values).toHaveBeenCalledTimes(1);
    const rows = values.mock.calls[0][0] as unknown[];
    expect(rows).toHaveLength(2 * SYSTEM_TEMPLATES.length);
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
  });
});
