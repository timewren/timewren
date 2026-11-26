/**
 * Handler-tests for Alunta-webhookens penge-kritiske stier (#424):
 * - fund 5: fejlede events skal kunne replayes og seats-annullerings-fallbacken beholder pladser ved API-fejl.
 * - fund 6: payment_failed/invoice_paid fra en ikke-linket (erstattet) sub
 *   må ikke mutere den sunde række.
 * - fund 1/2/7/9: seats-aktivering annullerer PRÆCIS de metadata-udpegede
 *   sub-UUID'er.
 *
 * DB og Alunta-klienten mockes; payloads sendes gennem den rigtige POST.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // Rækker som db-mockens findFirst returnerer
  webhookEventRow: undefined as unknown,
  subscriptionRow: undefined as Record<string, unknown> | undefined,
  // Optagede skrivninger
  updates: [] as Record<string, unknown>[],
  recordedEvents: [] as Record<string, unknown>[],
  // Alunta-mockens adfærd
  aluntaGet: undefined as
    | ((uuid: string) => Promise<{ data: Record<string, unknown> }>)
    | undefined,
  aluntaListAll: undefined as
    | ((externalId: string) => Promise<Record<string, unknown>[]>)
    | undefined,
  cancelled: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      webhookEvents: {
        findFirst: vi.fn(async () => state.webhookEventRow),
      },
      subscriptions: {
        findFirst: vi.fn(async () => state.subscriptionRow),
      },
      users: {
        findFirst: vi.fn(async () => ({
          name: "Test",
          email: "test@example.dk",
        })),
      },
      members: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(values);
          return Object.assign(Promise.resolve(), {
            returning: async () => [{ id: "row-1" }],
          });
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          state.recordedEvents.push(v);
        },
      }),
    }),
  },
}));

vi.mock("@/lib/alunta", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/alunta")>();
  return {
    ...actual,
    alunta: {
      subscriptions: {
        get: vi.fn(async (uuid: string) => {
          if (!state.aluntaGet) throw new Error("aluntaGet not configured");
          return state.aluntaGet(uuid);
        }),
        cancel: vi.fn(async (uuid: string) => {
          state.cancelled.push(uuid);
          return { data: { uuid } };
        }),
        listAllByExternalCustomerId: vi.fn(async (externalId: string) => {
          if (!state.aluntaListAll)
            throw new Error("aluntaListAll not configured");
          return state.aluntaListAll(externalId);
        }),
        addDiscount: vi.fn(async () => ({ data: {} })),
      },
    },
  };
});

vi.mock("@/lib/email/billing", () => ({
  sendPaymentFailedEmail: vi.fn(async () => {}),
  sendTrialEndingEmail: vi.fn(async () => {}),
}));

vi.mock("@/lib/notifications/admin", () => ({
  notifyAdmin: vi.fn(async () => {}),
}));

const captureRouteError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError }));

import { sendTrialEndingEmail } from "@/lib/email/billing";
import { notifyAdmin } from "@/lib/notifications/admin";
import { POST } from "../route";

const notifyAdminMock = vi.mocked(notifyAdmin);

const TEAM_SEATS = "plan-team-seats";
const TEAM_MONTHLY = "plan-team-monthly";

const WEBHOOK_SECRET = "test-webhook-secret";

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makeRequest(
  payload: Record<string, unknown>,
  { signed = true }: { signed?: boolean } = {},
): Request {
  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  });
  return new Request("http://localhost/api/alunta/webhook", {
    method: "POST",
    headers: signed ? { Signature: sign(body) } : {},
    body,
  });
}

/** Standard-række: team-abonnement linket til base-subben "base-1". */
function makeSubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    userId: "user-1",
    organizationId: "org-1",
    aluntaSubscriptionId: "base-1",
    aluntaCustomerId: "cust-1",
    status: "active",
    isTrial: false,
    trialEndsAt: new Date(Date.now() + 86400000),
    planTier: "team",
    updatedAt: new Date(),
    seatCount: 5,
    maxSeats: 5,
    discountPercent: 0,
    foundingTier: null,
    pastDueSince: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.webhookEventRow = undefined;
  state.subscriptionRow = undefined;
  state.updates = [];
  state.recordedEvents = [];
  state.aluntaGet = undefined;
  state.aluntaListAll = undefined;
  state.cancelled = [];
  captureRouteError.mockClear();
  vi.mocked(sendTrialEndingEmail).mockClear();
  notifyAdminMock.mockClear();
  // Alunta slået til med secret; makeRequest signerer som Alunta gør
  vi.stubEnv("ALUNTA_API_KEY", "test-alunta-key");
  vi.stubEnv("ALUNTA_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("ALUNTA_WEBHOOK_ALLOW_UNSIGNED", "");
  vi.stubEnv("ALUNTA_PLAN_TEAM_SEATS", TEAM_SEATS);
  vi.stubEnv("ALUNTA_PLAN_TEAM_MONTHLY", TEAM_MONTHLY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("passes the subscription organization to the trial-ending sender", async () => {
  state.subscriptionRow = makeSubRow({ organizationId: "subscription-org" });
  const res = await POST(
    makeRequest({
      event: "subscription.trial_ending",
      data: { external_customer_id: "user-1" },
    }),
  );

  expect(res.status).toBe(200);
  expect(sendTrialEndingEmail).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      organizationId: "subscription-org",
      userId: "user-1",
    }),
  );
});

describe("signaturtjek fejler lukket (#1103)", () => {
  const event = {
    event: "subscription.payment_failed",
    data: { subscription: { uuid: "base-1", status: "past_due" } },
  };

  it("svarer 404 og rører intet, når Alunta ikke er slået til", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "");
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
    expect(state.recordedEvents).toEqual([]);
  });

  it("svarer 503 og rører intet uden ALUNTA_WEBHOOK_SECRET", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "");
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(503);
    expect(state.updates).toEqual([]);
    expect(state.recordedEvents).toEqual([]);
  });

  it("ALLOW_UNSIGNED åbner ikke for manglende secret", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "");
    vi.stubEnv("ALUNTA_WEBHOOK_ALLOW_UNSIGNED", "1");
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(503);
    expect(state.updates).toEqual([]);
  });

  it("afviser usigneret request med 401", async () => {
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("afviser forkert signatur med 401", async () => {
    state.subscriptionRow = makeSubRow();
    const body = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    });
    const res = await POST(
      new Request("http://localhost/api/alunta/webhook", {
        method: "POST",
        headers: { Signature: sign(body, "forkert-secret") },
        body,
      }),
    );
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("ALLOW_UNSIGNED virker ikke med NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALUNTA_WEBHOOK_ALLOW_UNSIGNED", "1");
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("ALLOW_UNSIGNED accepterer usigneret request uden for production", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_ALLOW_UNSIGNED", "1");
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event, { signed: false }));
    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.status === "past_due")).toBe(true);
  });

  it("korrekt signatur behandles som før", async () => {
    state.subscriptionRow = makeSubRow();
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.status === "past_due")).toBe(true);
  });
});

describe("dedup + replay (fund 5)", () => {
  it("skipper et event dedup'en finder som allerede behandlet", async () => {
    state.webhookEventRow = { id: "evt-1", status: "success" };
    const res = await POST(
      makeRequest({
        event: "subscription.payment_failed",
        data: { subscription: { uuid: "base-1", status: "past_due" } },
      }),
    );
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(state.updates).toEqual([]);
  });

  it.each(["error", "success", undefined])(
    "behandler kun gamle signerede leveringer med en registreret fejl (%s)",
    async (status) => {
      state.aluntaGet = async () => ({ data: { status: "past_due" } });
      state.webhookEventRow = status ? { id: "evt-old", status } : undefined;
      state.subscriptionRow = makeSubRow();
      const res = await POST(
        makeRequest({
          timestamp: new Date(Date.now() - 86_400_000).toISOString(),
          event: "subscription.payment_failed",
          data: { subscription: { uuid: "base-1", status: "past_due" } },
        }),
      );
      expect(res.status).toBe(200);
      expect(state.updates.some((u) => u.status === "past_due")).toBe(
        status === "error",
      );
    },
  );

  it("ignores an old payment failure if Alunta now reports an active subscription", async () => {
    state.webhookEventRow = { id: "evt-old", status: "error" };
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = async () => ({ data: { status: "active" } });
    const res = await POST(
      makeRequest({
        timestamp: new Date(Date.now() - 86_400_000).toISOString(),
        event: "subscription.payment_failed",
        data: { subscription: { uuid: "base-1", status: "past_due" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([]);
  });

  it("genkører en registreret fejl og upserter resultatet", async () => {
    state.webhookEventRow = { id: "evt-1", status: "error" };
    state.subscriptionRow = makeSubRow();
    const res = await POST(
      makeRequest({
        event: "subscription.payment_failed",
        data: { subscription: { uuid: "base-1", status: "past_due" } },
      }),
    );
    expect((await res.json()).received).toBe(true);
    // Behandlet: rækken sat past_due, og eventet registreret via upsert
    expect(state.updates.some((u) => u.status === "past_due")).toBe(true);
    expect(state.recordedEvents).toHaveLength(1);
    expect(state.recordedEvents[0].status).toBe("success");
  });
});

describe("payment_failed/invoice_paid fra ikke-linket sub (fund 6)", () => {
  it("payment_failed fra en erstattet sub rører ikke den sunde række", async () => {
    state.subscriptionRow = makeSubRow(); // linket til base-1
    await POST(
      makeRequest({
        event: "subscription.payment_failed",
        data: {
          external_customer_id: "org-1",
          subscription: { uuid: "old-replaced-sub", status: "past_due" },
        },
      }),
    );
    expect(state.updates).toEqual([]);
  });

  it("invoice.paid fra en erstattet sub flipper ikke status/trial", async () => {
    state.subscriptionRow = makeSubRow({ status: "trialing", isTrial: true });
    await POST(
      makeRequest({
        event: "invoice.paid",
        data: {
          customer: { uuid: "cust-1", name: "Test", email: "t@e.dk" },
          invoice: {
            uuid: "inv-1",
            status: "paid",
            amount_due: 19900,
            subscription_uuid: "old-replaced-sub",
          },
        },
      }),
    );
    expect(state.updates).toEqual([]);
  });

  it("payment_failed på den LINKEDE sub opdaterer stadig rækken", async () => {
    state.subscriptionRow = makeSubRow();
    await POST(
      makeRequest({
        event: "subscription.payment_failed",
        data: { subscription: { uuid: "base-1", status: "past_due" } },
      }),
    );
    expect(state.updates.some((u) => u.status === "past_due")).toBe(true);
  });
});

describe("seats-aktivering annullerer præcis metadata-UUID'erne (fund 1)", () => {
  it("annullerer de udpegede live subs og opdaterer kun pladstal", async () => {
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = async (uuid) => ({
      data: { uuid, status: "active", plan: { uuid: TEAM_SEATS } },
    });
    await POST(
      makeRequest({
        event: "checkout.completed",
        data: {
          external_customer_id: "org-1",
          customer: { uuid: "cust-1", name: "Test", email: "t@e.dk" },
          subscription: {
            uuid: "new-seats",
            status: "active",
            quantity: 5,
            plan: { name: "Team Ekstra pladser", uuid: TEAM_SEATS },
            metadata: {
              seats_replacement: true,
              replaces_subscription_uuids: ["old-seats"],
            },
          },
        },
      }),
    );
    // Præcis den udpegede sub annulleres — intet klassificerings-gæt
    expect(state.cancelled).toEqual(["old-seats"]);
    // Rækken beholder base-linket; kun pladstallet justeres (2 inkl. + 5)
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].seatCount).toBe(7);
    expect(state.updates[0].maxSeats).toBe(7);
    expect(state.updates[0].aluntaSubscriptionId).toBeUndefined();
  });

  it("annullerer IKKE en udpeget sub der ikke længere er live, og alarmerer ved tom liste", async () => {
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = async (uuid) => ({
      data: { uuid, status: "cancelled", plan: { uuid: TEAM_SEATS } },
    });
    await POST(
      makeRequest({
        event: "checkout.completed",
        data: {
          external_customer_id: "org-1",
          subscription: {
            uuid: "new-seats",
            status: "active",
            quantity: 3,
            plan: { name: "Team Ekstra pladser", uuid: TEAM_SEATS },
            metadata: {
              seats_replacement: true,
              replaces_subscription_uuids: ["already-dead"],
            },
          },
        },
      }),
    );
    expect(state.cancelled).toEqual([]);

    // Tom udpeget liste → høj alarm, aldrig tavs no-op
    captureRouteError.mockClear();
    await POST(
      makeRequest({
        event: "subscription.started",
        data: {
          external_customer_id: "org-1",
          subscription: {
            uuid: "new-seats-2",
            status: "active",
            quantity: 3,
            plan: { name: "Team Ekstra pladser", uuid: TEAM_SEATS },
            metadata: {
              seats_replacement: true,
              replaces_subscription_uuids: [],
            },
          },
        },
      }),
    );
    expect(captureRouteError).toHaveBeenCalled();
  });
});

describe("seats-annullerings-ekko: sikker fallback ved API-fejl (fund 5)", () => {
  it("beholder nuværende pladser og alarmerer når Alunta-opslaget fejler", async () => {
    state.subscriptionRow = makeSubRow(); // linket til base-1, 5 pladser
    state.aluntaListAll = async () => {
      throw new Error("Alunta API 500");
    };
    await POST(
      makeRequest({
        event: "subscription.cancelled",
        data: {
          external_customer_id: "org-1",
          subscription: {
            uuid: "old-seats",
            status: "cancelled",
            plan: { name: "Team Ekstra pladser", uuid: TEAM_SEATS },
          },
        },
      }),
    );
    // Ingen reduktion af pladser — og høj alarm i stedet for et kast
    expect(state.updates).toEqual([]);
    expect(captureRouteError).toHaveBeenCalled();
    // Eventet registreres som succes (fallbacken er den besluttede handling)
    expect(state.recordedEvents[0]?.status).toBe("success");
  });
});

describe("dobbelt-abonnement-vagt: fallback på customer.uuid (kunde B 1/9-2026)", () => {
  /** Alunta-mock: begge subs live — den linkede base-1 og den fremmede. */
  const bothLive = async (uuid: string) => ({
    data: { uuid, status: "active", plan: { uuid: TEAM_MONTHLY } },
  });

  it("subscription.started uden external_customer_id på kendt kunde → Discord-alarm + needs_review, ingen mutation", async () => {
    state.subscriptionRow = makeSubRow(); // linket til base-1, kunde cust-1
    state.aluntaGet = bothLive;
    const res = await POST(
      makeRequest({
        event: "subscription.started",
        data: {
          customer: {
            uuid: "cust-1",
            name: "Eksempel ApS",
            email: "b@example.dk",
          },
          subscription: {
            uuid: "foreign-1",
            status: "active",
            plan: { uuid: TEAM_MONTHLY, name: "Team" },
            customer: { uuid: "cust-1", name: "Eksempel ApS" },
          },
        },
      }),
    );
    expect((await res.json()).received).toBe(true);
    // Den linkede række må ikke rykkes (ingen re-link, ingen statusflip)
    expect(state.updates).toEqual([]);
    // Ingen auto-annullering
    expect(state.cancelled).toEqual([]);
    // Alarm med begge UUID'er og manuel instruktion
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    const [event, payload] = notifyAdminMock.mock.calls[0];
    expect(event).toBe("subscription_duplicate");
    expect(payload.userEmail).toBe("test@example.dk");
    expect(payload.reason).toContain("base-1");
    expect(payload.reason).toContain("foreign-1");
    expect(payload.reason).toContain("annullér manuelt");
    expect(captureRouteError).toHaveBeenCalled();
    // Eventet gemmes så det kan findes — ikke som stille success
    expect(state.recordedEvents).toHaveLength(1);
    expect(state.recordedEvents[0].status).toBe("needs_review");
    expect(String(state.recordedEvents[0].errorMessage)).toContain(
      "dobbelt-abonnement",
    );
  });

  it("subscription.started uden external_customer_id og uden kunde-match → uændret adfærd (log, success, ingen alarm)", async () => {
    state.subscriptionRow = undefined;
    const res = await POST(
      makeRequest({
        event: "subscription.started",
        data: {
          customer: { uuid: "unknown-cust", name: "X", email: "x@x.dk" },
          subscription: { uuid: "foreign-1", status: "active" },
        },
      }),
    );
    expect((await res.json()).received).toBe(true);
    expect(state.updates).toEqual([]);
    expect(notifyAdminMock).not.toHaveBeenCalled();
    expect(state.recordedEvents[0].status).toBe("success");
  });

  it("alarmerer IKKE når den linkede sub er bekræftet død (erstatning, ikke duplikat)", async () => {
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = async (uuid) => ({
      data: { uuid, status: uuid === "base-1" ? "cancelled" : "active" },
    });
    await POST(
      makeRequest({
        event: "subscription.started",
        data: {
          customer: { uuid: "cust-1", name: "T", email: "t@e.dk" },
          subscription: { uuid: "foreign-1", status: "active" },
        },
      }),
    );
    expect(state.updates).toEqual([]);
    expect(notifyAdminMock).not.toHaveBeenCalled();
    expect(state.recordedEvents[0].status).toBe("success");
  });

  it("invoice.paid fra en fremmed LIVE sub → alarm; fra en annulleret sub → ingen alarm", async () => {
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = bothLive;
    await POST(
      makeRequest({
        event: "invoice.paid",
        data: {
          customer: { uuid: "cust-1", name: "T", email: "t@e.dk" },
          invoice: {
            uuid: "inv-1",
            status: "paid",
            subscription_uuid: "foreign-1",
          },
        },
      }),
    );
    expect(state.updates).toEqual([]);
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    expect(state.recordedEvents[0].status).toBe("needs_review");

    notifyAdminMock.mockClear();
    state.recordedEvents = [];
    state.aluntaGet = async (uuid) => ({
      data: { uuid, status: uuid === "foreign-1" ? "cancelled" : "active" },
    });
    await POST(
      makeRequest({
        event: "invoice.paid",
        data: {
          customer: { uuid: "cust-1", name: "T", email: "t@e.dk" },
          invoice: {
            uuid: "inv-2",
            status: "paid",
            subscription_uuid: "foreign-1",
          },
        },
      }),
    );
    expect(notifyAdminMock).not.toHaveBeenCalled();
    expect(state.recordedEvents[0].status).toBe("success");
  });

  it("payment_failed uden external_customer_id fra fremmed sub → alarm, rækken rykkes ikke", async () => {
    state.subscriptionRow = makeSubRow();
    state.aluntaGet = bothLive;
    await POST(
      makeRequest({
        event: "subscription.payment_failed",
        data: {
          customer: { uuid: "cust-1", name: "T", email: "t@e.dk" },
          subscription: { uuid: "foreign-1", status: "past_due" },
        },
      }),
    );
    expect(state.updates).toEqual([]);
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    expect(state.recordedEvents[0].status).toBe("needs_review");
  });
});
