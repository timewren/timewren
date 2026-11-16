import { beforeEach, describe, expect, it, vi } from "vitest";

// Standard-registry/-store trækker DB og Resend ind ved import — mock dem væk.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/resend", () => ({ resend: {}, DEFAULT_FROM_EMAIL: "x" }));

import { createNotificationBus } from "../bus";
import {
  ChannelSkipped,
  type NotificationChannel,
  type OutgoingNotification,
} from "../channels/types";
import type { NotificationChannelKey } from "../events";
import type {
  BusStore,
  DeliveryRecord,
  OrgNotificationContext,
} from "../store";

function makeStore(
  overrides: Partial<OrgNotificationContext> = {},
  prefs: Record<string, Record<string, Record<string, boolean>>> = {},
) {
  const logged: DeliveryRecord[] = [];
  const store: BusStore = {
    loadOrg: vi.fn(async () => ({
      orgName: "Eksempel Skole",
      channelDefaults: null,
      teamsEnabled: false,
      teamsWebhookUrl: null,
      ...overrides,
    })),
    loadRecipients: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        userId: id,
        name: `Bruger ${id}`,
        email: `${id}@example.com`,
      })),
    ),
    loadUserPreferences: vi.fn(
      async () => new Map(Object.entries(prefs)) as never,
    ),
    logDeliveries: vi.fn(async (rows: DeliveryRecord[]) => {
      logged.push(...rows);
    }),
  };
  return { store, logged };
}

function makeChannel(
  key: NotificationChannelKey,
  impl: (msg: OutgoingNotification) => Promise<void> = async () => {},
  scope: "user" | "org" = key === "teams" ? "org" : "user",
): NotificationChannel & { send: ReturnType<typeof vi.fn> } {
  return { key, scope, send: vi.fn(impl) } as never;
}

function makeChannels(
  channels: NotificationChannel[],
): ReadonlyMap<NotificationChannelKey, NotificationChannel> {
  return new Map(channels.map((c) => [c.key, c]));
}

const sleep = vi.fn(async () => {});
const log = vi.fn();

beforeEach(() => {
  sleep.mockClear();
  log.mockClear();
});

describe("notify — fan-out", () => {
  it("sender til in_app + email pr. modtager og udelader aktøren", async () => {
    const { store, logged } = makeStore();
    const inApp = makeChannel("in_app");
    const email = makeChannel("email");
    const push = makeChannel("push");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([inApp, email, push]),
      sleep,
      log,
    });

    const result = await bus.notify({
      orgId: "org-1",
      event: "timesheet.submitted",
      payload: {
        employeeName: "Mette",
        employeeUserId: "u-mette",
        weekStart: "2026-08-24",
        totalHours: 37,
      },
      userIds: ["u-leder", "u-admin", "u-mette"],
      excludeUserId: "u-mette",
    });

    expect(inApp.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledTimes(2);
    // push er slået fra for timesedler i de indbyggede defaults
    expect(push.send).not.toHaveBeenCalled();
    expect(result.sent).toBe(4);
    expect(logged).toHaveLength(4);
    expect(logged.every((d) => d.status === "sent")).toBe(true);
    const recipients = inApp.send.mock.calls.map(
      (c) => (c[0] as OutgoingNotification).recipient?.userId,
    );
    expect(recipients.sort()).toEqual(["u-admin", "u-leder"]);
  });

  it("treats disabled channels as an intentional opt-out", async () => {
    const { store } = makeStore({
      channelDefaults: {
        compliance: { in_app: false, email: false, push: false, teams: false },
      },
    });
    const bus = createNotificationBus({
      store,
      channels: makeChannels([makeChannel("email")]),
      sleep,
      log,
    });
    const result = await bus.notify({
      orgId: "org-1",
      event: "compliance.forecast",
      payload: { weekStart: "2026-11-09", findings: ["Hvile"] },
      userIds: ["u-1"],
    });
    expect(result).toEqual({ deliveries: [], sent: 0, failed: 0, skipped: 0 });
  });

  it("rendrer titel/tekst/url til kanalerne", async () => {
    const { store } = makeStore();
    const inApp = makeChannel("in_app");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([inApp]),
      sleep,
      log,
    });
    await bus.notify({
      orgId: "org-1",
      event: "absence.rejected",
      payload: {
        managerName: "Rasmus",
        typeName: "Ferie",
        startDate: "2026-09-01",
        endDate: "2026-09-05",
        rejectionReason: "Underbemandet",
      },
      userIds: ["u-1"],
    });
    const msg = inApp.send.mock.calls[0][0] as OutgoingNotification;
    expect(msg.rendered.title).toBe("Fravær afvist");
    expect(msg.rendered.body).toContain("Rasmus har afvist din ferie");
    expect(msg.rendered.body).toContain("Underbemandet");
    expect(msg.rendered.url).toBe("/dashboard/enterprise/absence");
  });

  it("respekterer bruger-præferencer oven på org-defaults", async () => {
    const { store } = makeStore(
      { channelDefaults: { timesheet: { email: false } } },
      { "u-2": { timesheet: { email: true, in_app: false } } },
    );
    const inApp = makeChannel("in_app");
    const email = makeChannel("email");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([inApp, email]),
      sleep,
      log,
    });
    await bus.notify({
      orgId: "org-1",
      event: "timesheet.approved",
      payload: { managerName: "Leder", weekStart: "2026-08-24" },
      userIds: ["u-1", "u-2"],
    });
    // u-1: org-default (email fra) → kun in_app; u-2: override → kun email
    expect(inApp.send).toHaveBeenCalledTimes(1);
    expect(
      (inApp.send.mock.calls[0][0] as OutgoingNotification).recipient?.userId,
    ).toBe("u-1");
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(
      (email.send.mock.calls[0][0] as OutgoingNotification).recipient?.userId,
    ).toBe("u-2");
  });
});

describe("notify — Teams", () => {
  it("sender ét kort pr. leder-hændelse uanset antal modtagere", async () => {
    const { store } = makeStore({
      teamsEnabled: true,
      teamsWebhookUrl: "https://x.webhook.office.com/hook",
    });
    const teams = makeChannel("teams");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([teams]),
      sleep,
      log,
    });
    await bus.notify({
      orgId: "org-1",
      event: "timesheet.submitted",
      payload: {
        employeeName: "Mette",
        employeeUserId: "u-mette",
        weekStart: "2026-08-24",
        totalHours: 37,
      },
      userIds: ["u-a", "u-b", "u-c"],
    });
    expect(teams.send).toHaveBeenCalledTimes(1);
    const msg = teams.send.mock.calls[0][0] as OutgoingNotification;
    expect(msg.teamsWebhookUrl).toBe("https://x.webhook.office.com/hook");
    expect(msg.recipient).toBeUndefined();
  });

  it("sender ikke medarbejder-hændelser til Teams", async () => {
    const { store } = makeStore({
      teamsEnabled: true,
      teamsWebhookUrl: "https://x.webhook.office.com/hook",
    });
    const teams = makeChannel("teams");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([teams]),
      sleep,
      log,
    });
    await bus.notify({
      orgId: "org-1",
      event: "timesheet.approved",
      payload: { managerName: "Leder", weekStart: "2026-08-24" },
      userIds: ["u-1"],
    });
    expect(teams.send).not.toHaveBeenCalled();
  });
});

describe("notify — fejlhåndtering", () => {
  it("fejl i én kanal stopper ikke de andre og kaster aldrig", async () => {
    const { store, logged } = makeStore();
    const inApp = makeChannel("in_app", async () => {
      throw new Error("DB nede");
    });
    const email = makeChannel("email");
    const bus = createNotificationBus({
      store,
      channels: makeChannels([inApp, email]),
      sleep,
      log,
    });
    const result = await bus.notify({
      orgId: "org-1",
      event: "timesheet.reopened",
      payload: { managerName: "Leder", weekStart: "2026-08-24" },
      userIds: ["u-1"],
    });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    const failed = logged.find((d) => d.channel === "in_app");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("DB nede");
    expect(log).toHaveBeenCalled();
  });

  it("prøver igen én gang ved transient fejl", async () => {
    const { store, logged } = makeStore();
    let calls = 0;
    const email = makeChannel("email", async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed: ECONNRESET");
    });
    const bus = createNotificationBus({
      store,
      channels: makeChannels([email]),
      sleep,
      log,
    });
    const result = await bus.notify({
      orgId: "org-1",
      event: "timesheet.approved",
      payload: { managerName: "Leder", weekStart: "2026-08-24" },
      userIds: ["u-1"],
    });
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(logged[0].attempts).toBe(2);
  });

  it("prøver ikke igen ved permanent fejl", async () => {
    const { store, logged } = makeStore();
    let calls = 0;
    const email = makeChannel("email", async () => {
      calls++;
      throw new Error("Ugyldig modtager");
    });
    const bus = createNotificationBus({
      store,
      channels: makeChannels([email]),
      sleep,
      log,
    });
    await bus.notify({
      orgId: "org-1",
      event: "timesheet.approved",
      payload: { managerName: "Leder", weekStart: "2026-08-24" },
      userIds: ["u-1"],
    });
    expect(calls).toBe(1);
    expect(logged[0].status).toBe("failed");
  });

  it("logger skipped når kanalen intet har at levere", async () => {
    const { store, logged } = makeStore();
    const push = makeChannel("push", async () => {
      throw new ChannelSkipped("Ingen push-abonnementer");
    });
    const bus = createNotificationBus({
      store,
      channels: makeChannels([push]),
      sleep,
      log,
    });
    const result = await bus.notify({
      orgId: "org-1",
      event: "absence.approved",
      payload: {
        managerName: "Leder",
        typeName: "Ferie",
        startDate: "2026-09-01",
        endDate: null,
      },
      userIds: ["u-1"],
    });
    expect(result.skipped).toBe(1);
    expect(logged[0].status).toBe("skipped");
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["loadOrg", "loadRecipients", "loadUserPreferences"] as const)(
    "markerer %s-fejl som fejlet udsendelse",
    async (lookup) => {
      const { store } = makeStore();
      (store[lookup] as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("boom"),
      );
      const bus = createNotificationBus({
        store,
        channels: makeChannels([makeChannel("email")]),
        sleep,
        log,
      });
      const result = await bus.notify({
        orgId: "org-1",
        event: "timesheet.approved",
        payload: { managerName: "Leder", weekStart: "2026-08-24" },
        userIds: ["u-1"],
      });
      expect(result.deliveries).toEqual([]);
      expect(result.failed).toBe(1);
      expect(log).toHaveBeenCalled();
    },
  );
});
