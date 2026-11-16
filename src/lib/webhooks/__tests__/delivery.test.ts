import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateSets: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];
  return {
    updateSets,
    insertValues,
    db: {
      execute: vi.fn(),
      query: {
        outgoingWebhooks: { findFirst: vi.fn(), findMany: vi.fn() },
        webhookDeliveries: { findMany: vi.fn() },
      },
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          updateSets.push(values);
          return { where: async () => undefined };
        },
      })),
      insert: vi.fn(() => ({
        values: async (values: Record<string, unknown>) => {
          insertValues.push(values);
        },
      })),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("../signing", () => ({ signWebhookPayload: () => "sha256=test" }));
const ssrfMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/lib/utils/ssrf-protection", () => ({
  validateUrlForSSRF: ssrfMock,
}));

import {
  nextRetryAt,
  retryFailedWebhooks,
  testWebhook,
  triggerWebhooks,
} from "../delivery";

const webhook = {
  id: "wh-1",
  userId: "user-1",
  organizationId: null,
  name: "Testkunde ApS",
  url: "https://hooks.example.com/in",
  secret: "enc",
  events: ["client.created"],
  clientId: null,
  projectId: null,
  isActive: true,
  retryCount: 5,
  timeoutMs: 1000,
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateSets.length = 0;
  mocks.insertValues.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Body der aldrig slutter af sig selv. */
function endlessBody(): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode("x".repeat(1024));
  return new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
}

/** Body der sender én chunk og derefter hænger. */
function hangingBody(): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode("ok"));
        return;
      }
      return new Promise(() => {});
    },
  });
}

describe("deliverWebhook: SSRF-værn (#1111)", () => {
  it("afviser levering ved DNS-fejl (fail closed)", async () => {
    mocks.db.query.outgoingWebhooks.findFirst.mockResolvedValue(webhook);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await testWebhook("wh-1", "user-1");
    expect(ssrfMock).toHaveBeenCalledWith(webhook.url, {
      rejectOnDnsFailure: true,
    });
  });

  it("følger ikke redirects og melder 3xx som fejl", async () => {
    mocks.db.query.outgoingWebhooks.findFirst.mockResolvedValue(webhook);
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      }),
    );

    const result = await testWebhook("wh-1", "user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(result.success).toBe(false);
    expect(result.responseStatus).toBe(302);
  });

  it("læser kun en begrænset del af et uendeligt svar", async () => {
    mocks.db.query.outgoingWebhooks.findMany.mockResolvedValue([webhook]);
    fetchMock.mockResolvedValue(new Response(endlessBody(), { status: 200 }));

    const result = await triggerWebhooks("user-1", "client.created", null, {});

    expect(result.delivered).toBe(1);
    const body = mocks.insertValues[0].responseBody as string;
    expect(body.length).toBeLessThanOrEqual(1000 + "...[truncated]".length);
  }, 5000);

  it("timeout dækker også læsningen af svar-body", async () => {
    mocks.db.query.outgoingWebhooks.findFirst.mockResolvedValue({
      ...webhook,
      timeoutMs: 50,
    });
    fetchMock.mockResolvedValue(new Response(hangingBody(), { status: 200 }));

    const result = await testWebhook("wh-1", "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  }, 5000);
});

describe("retryFailedWebhooks: claim og backoff (#1111)", () => {
  const dialect = new PgDialect();

  function claimSql(): string {
    const query = mocks.db.execute.mock.calls[0][0] as SQL;
    return dialect.sqlToQuery(query).sql;
  }

  it("claimer forfaldne leveringer med SKIP LOCKED, sorteret efter scheduled_for", async () => {
    mocks.db.execute.mockResolvedValue([]);

    const result = await retryFailedWebhooks();

    expect(result.processed).toBe(0);
    const text = claimSql();
    expect(text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(text).toMatch(/scheduled_for <= /);
    expect(text).toMatch(/ORDER BY scheduled_for/);
    // Intet claimet: ingen levering hentes eller sendes.
    expect(mocks.db.query.webhookDeliveries.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("udskyder næste forsøg med backoff ved fejl", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    mocks.db.execute.mockResolvedValue([{ id: "d-1" }]);
    mocks.db.query.webhookDeliveries.findMany.mockResolvedValue([
      {
        id: "d-1",
        attemptNumber: 1,
        payload: { event: "client.created", timestamp: "x", data: {} },
        webhook,
      },
    ]);
    fetchMock.mockResolvedValue(new Response("nej", { status: 500 }));

    const result = await retryFailedWebhooks();

    expect(result.failed).toBe(1);
    const set = mocks.updateSets.find((s) => s.status === "pending_retry");
    expect(set).toBeDefined();
    const next = set?.scheduledFor as Date;
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("første fejlede levering planlægges ud i fremtiden", async () => {
    mocks.db.query.outgoingWebhooks.findMany.mockResolvedValue([webhook]);
    fetchMock.mockResolvedValue(new Response("nej", { status: 500 }));

    await triggerWebhooks("user-1", "client.created", null, {});

    const values = mocks.insertValues[0];
    expect(values.status).toBe("pending_retry");
    expect((values.scheduledFor as Date).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("nextRetryAt (#1111)", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const minutesAfter = (attempt: number) =>
    (nextRetryAt(attempt, now).getTime() - now.getTime()) / 60_000;

  it("følger backoff-tabellen og gentager sidste trin", () => {
    expect([1, 2, 3, 4, 5, 6].map(minutesAfter)).toEqual([
      1, 5, 30, 120, 360, 360,
    ]);
  });
});
