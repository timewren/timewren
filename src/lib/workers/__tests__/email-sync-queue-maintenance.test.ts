import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  failStaleProcessingJobs,
  STALE_PROCESSING_AFTER_MS,
} from "../email-sync-queue-maintenance";

/**
 * Værdierne i et drizzle-condition-træ: eq pakker dem i Param, og
 * lte(kolonne, Date) lader Date ligge direkte i queryChunks.
 */
function conditionValues(node: unknown, out: unknown[] = []): unknown[] {
  if (node instanceof Date) {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) conditionValues(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const chunk = node as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (chunk.constructor?.name === "Param") {
    out.push(chunk.value);
    return out;
  }
  for (const child of chunk.queryChunks ?? []) conditionValues(child, out);
  return out;
}

const NOW = new Date("2026-10-11T12:00:00.000Z");

describe("failStaleProcessingJobs", () => {
  const set = vi.fn();
  const where = vi.fn();
  const returning = vi.fn();
  const del = vi.fn();
  const db = {
    update: vi.fn(() => ({
      set: (values: unknown) => {
        set(values);
        return {
          where: (condition: unknown) => {
            where(condition);
            return { returning };
          },
        };
      },
    })),
    delete: del,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    returning.mockResolvedValue([{ id: "job-1" }]);
  });

  it("markerer processing-jobs ældre end 1 time som failed", async () => {
    const count = await failStaleProcessingJobs(db, NOW);

    expect(count).toBe(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        completedAt: NOW,
        updatedAt: NOW,
        errorMessage: expect.stringContaining("processing"),
      }),
    );
    // Slettes aldrig; jobbet bevares som failed til oprydning efter 7 dage
    expect(del).not.toHaveBeenCalled();
  });

  it("filtrerer på status processing og et skæringstidspunkt præcis 1 time tilbage", async () => {
    await failStaleProcessingJobs(db, NOW);

    const values = conditionValues(where.mock.calls[0][0]);
    expect(values).toContain("processing");
    // pending/completed/failed må ikke kunne ramme
    expect(values).not.toContain("pending");

    const cutoff = new Date(NOW.getTime() - STALE_PROCESSING_AFTER_MS);
    const dates = values.filter((v): v is Date => v instanceof Date);
    // startedAt-grenen og updatedAt-fallbacken bruger samme skæringstidspunkt
    expect(dates.length).toBeGreaterThanOrEqual(2);
    for (const date of dates) {
      expect(date.getTime()).toBe(cutoff.getTime());
    }
    expect(STALE_PROCESSING_AFTER_MS).toBe(3_600_000);
  });

  it("returnerer 0 når intet hænger", async () => {
    returning.mockResolvedValue([]);
    expect(await failStaleProcessingJobs(db, NOW)).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
