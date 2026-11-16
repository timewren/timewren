import { beforeEach, describe, expect, it, vi } from "vitest";

// Planlæggeren springer en bruger over, så længe et job står i pending eller
// processing. Hængende jobs skal derfor ryddes FØR integrationerne planlægges.

const order = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/workers/email-sync-queue-maintenance", () => ({
  failStaleProcessingJobs: vi.fn(async () => {
    order.push("fail-stale");
    return 1;
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    delete: () => ({
      where: async () => {
        order.push("cleanup-old");
      },
    }),
    query: {
      emailIntegrations: {
        findMany: vi.fn(async () => {
          order.push("plan");
          return [];
        }),
      },
      emailSyncQueue: { findMany: vi.fn(async () => []) },
    },
  },
}));

// Resten af workerens afhængigheder bruges ikke af denne test
vi.mock("@/lib/ai", () => ({}));
vi.mock("@/lib/ai/email-classifier", () => ({}));
vi.mock("@/lib/ai/sanitize", () => ({}));
vi.mock("@/lib/ai/task-parser", () => ({}));
vi.mock("@/lib/email/store-attachments", () => ({}));
vi.mock("@/lib/services/customer-matcher", () => ({}));
vi.mock("@/lib/services/imap-client", () => ({}));
vi.mock("@/lib/services/thread-resolver", () => ({}));
vi.mock("@/lib/utils/email-blocklist", () => ({}));
vi.mock("@/lib/utils/encryption", () => ({}));

const { processEmailSyncQueue } = await import("../email-sync-worker");

describe("processEmailSyncQueue", () => {
  beforeEach(() => {
    order.length = 0;
  });

  it("rydder hængende processing-jobs før integrationerne planlægges", async () => {
    const result = await processEmailSyncQueue();

    expect(result).toEqual({ processed: 0 });
    expect(order.indexOf("fail-stale")).toBe(0);
    expect(order.indexOf("plan")).toBeGreaterThan(order.indexOf("fail-stale"));
  });
});
