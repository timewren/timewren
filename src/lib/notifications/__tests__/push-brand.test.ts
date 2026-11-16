/**
 * Push-testen (Indstillinger → Notifikationer → Test) følger kaldets brand:
 * i et tRPC-kald fra timewren.com siger tekst og ikon TimeWren, selv om
 * buildet er TimeTrack. Uden brand (timetrack.dk, cron) er alt som før.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBrand } from "@/i18n/server-text";

const sent = vi.hoisted(() => [] as string[]);
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (_sub: unknown, payload: string) => {
      sent.push(payload);
    }),
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

const subscription = {
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p", auth: "a" },
};

let testPushSubscription: typeof import("../push").testPushSubscription;
beforeAll(async () => {
  // VAPID-nøglerne læses ved import.
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  ({ testPushSubscription } = await import("../push"));
});

async function lastPayload(run: () => Promise<boolean>) {
  sent.length = 0;
  expect(await run()).toBe(true);
  return JSON.parse(sent[0]) as { body: string; icon: string };
}

describe("testPushSubscription", () => {
  it("siger TimeWren med TimeWren-ikon i et TimeWren-kald", async () => {
    const p = await lastPayload(() =>
      runWithBrand("timewren", () => testPushSubscription(subscription, "en")),
    );
    expect(p.body).toContain("TimeWren");
    expect(p.body).not.toContain("TimeTrack");
    expect(p.icon).toBe("/brand/timewren/icon-192.png");
  });

  it("er uændret uden brand (timetrack.dk, build-brandet)", async () => {
    const p = await lastPayload(() => testPushSubscription(subscription, "en"));
    expect(p.body).toBe("Push notifications are now enabled for TimeTrack!");
    expect(p.icon).toBe("/icons/icon-192x192.png");
  });
});
