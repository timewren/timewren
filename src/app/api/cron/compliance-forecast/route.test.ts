import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  previous: vi.fn(),
  insert: vi.fn(),
  inputs: vi.fn(),
  profiles: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_: string, handler: unknown) => handler,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      organizationModules: {
        findMany: async () => [{ organizationId: "org-test" }],
      },
      employeeProfiles: { findMany: mocks.profiles },
    },
    transaction: async (run: (tx: unknown) => unknown) =>
      run({
        execute: mocks.lock,
        query: { orgAuditLogs: { findFirst: mocks.previous } },
        insert: () => ({ values: mocks.insert }),
      }),
  },
}));
vi.mock("@/lib/enterprise/compliance-guard", async (original) => ({
  ...(await original<object>()),
  loadComplianceRuleSettings: async () => ({
    referencePeriodMonths: 4,
    rules: { rule48h: "warn", dailyRest: "warn" },
  }),
}));
vi.mock("@/lib/enterprise/compliance-inputs", () => ({
  loadComplianceInputs: mocks.inputs,
}));
vi.mock("@/lib/enterprise/work-plan-load", () => ({
  loadPlanMembers: async () => [
    { userId: "employee-test", departmentId: null },
  ],
  loadPlanLookups: async () =>
    new Map([["employee-test", { hasPlan: () => true }]]),
}));
vi.mock("@/lib/notifications/bus", () => ({
  notify: mocks.notify,
  resolveManagerRecipientIds: async () => ["manager-test", "employee-test"],
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

import { GET } from "./route";

describe("forecast cron", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T06:00:00Z"));
    mocks.profiles.mockResolvedValue([
      { userId: "employee-test", isSelfScheduler: false },
    ]);
    mocks.previous.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue({ failed: 0 });
    mocks.inputs.mockResolvedValue({
      entriesByUser: new Map([
        [
          "employee-test",
          [
            {
              date: "2026-11-08",
              hours: 8,
              startTime: new Date("2026-11-08T14:00Z"),
              endTime: new Date("2026-11-08T23:00Z"),
            },
            {
              date: "2026-11-09",
              hours: 8,
              startTime: new Date("2026-11-09T08:00Z"),
              endTime: new Date("2026-11-09T16:00Z"),
            },
          ],
        ],
      ]),
      neutralAbsenceByUser: new Map(),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends through the bus to employee and managers and records success", async () => {
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "compliance.forecast",
        userIds: ["employee-test", "manager-test"],
      }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { weekStart: "2026-11-09" } }),
    );
  });
  it("does not resend a completed weekly forecast", async () => {
    mocks.previous.mockResolvedValue({ id: "sent-test" });
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("keeps delivery failures retryable", async () => {
    mocks.notify.mockResolvedValue({ failed: 1 });
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("records intentional channel opt-outs without retrying", async () => {
    mocks.notify.mockResolvedValue({
      deliveries: [],
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.insert).toHaveBeenCalled();
  });
  it("skips exempt employees", async () => {
    mocks.profiles.mockResolvedValue([
      { userId: "employee-test", isSelfScheduler: true },
    ]);
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("does not send on other weekdays", async () => {
    vi.setSystemTime(new Date("2026-11-05T06:00:00Z"));
    await GET(new Request("http://localhost/api/cron/compliance-forecast"));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
