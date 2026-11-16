/**
 * Google Play-webhooken (#1113): Pub/Sub-push er kun beskyttet af et hemmeligt
 * token i URL'en, så tokentjekket ER adgangskontrollen på denne pengevej.
 * Tilstandsskiftet testes mod rigtig Postgres i
 * src/lib/store-billing/__tests__/store-billing.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/store-billing/google", () => ({
  getGooglePlayClient: () => ({ getSubscription: vi.fn() }),
}));
vi.mock("@/lib/store-billing/service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  handleGooglePlayNotification: vi.fn(),
}));

import { handleGooglePlayNotification } from "@/lib/store-billing/service";
import { captureRouteError } from "@/lib/utils/sentry";
import { POST } from "./route";

const TOKEN = "google-play-push-token";
/**
 * Forkert token med PRÆCIS samme længde som det rigtige. Uden det er
 * `timingSafeEqual` i route.ts aldrig udøvet negativt: alle andre varianter
 * falder på længde-tjekket, og et tjek der kun sammenlignede længder ville
 * slippe ethvert 22-tegns-token igennem med grønne tests.
 */
const SAME_LENGTH_TOKEN = "forkert-token-22-tegn!";

const message = (data: Record<string, unknown>) => ({
  message: {
    messageId: "pubsub-1",
    data: Buffer.from(JSON.stringify(data)).toString("base64"),
  },
  subscription: "projects/p/subscriptions/s",
});

function post(token: string | null, body: unknown = message({ version: "1" })) {
  const url = token
    ? `http://localhost/api/webhooks/google-play?token=${encodeURIComponent(token)}`
    : "http://localhost/api/webhooks/google-play";
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("STORE_BILLING_ENABLED", "1");
  vi.stubEnv("GOOGLE_PLAY_WEBHOOK_TOKEN", TOKEN);
  vi.mocked(handleGooglePlayNotification).mockResolvedValue({
    outcome: "applied",
    eventId: "pubsub-1",
    notificationType: "SUBSCRIPTION_RENEWED",
    subscriptionId: "sub-1",
  } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Google Play-webhook", () => {
  it("er mørk (404) uden STORE_BILLING_ENABLED og uden token-env", async () => {
    vi.stubEnv("STORE_BILLING_ENABLED", "");
    expect((await post(TOKEN)).status).toBe(404);

    vi.stubEnv("STORE_BILLING_ENABLED", "1");
    vi.stubEnv("GOOGLE_PLAY_WEBHOOK_TOKEN", "");
    expect((await post(TOKEN)).status).toBe(404);

    expect(handleGooglePlayNotification).not.toHaveBeenCalled();
  });

  it("afviser manglende, forkert og for kort token", async () => {
    for (const token of [
      null,
      SAME_LENGTH_TOKEN,
      "forkert-token-samme-laengde!",
      "kort",
    ]) {
      const res = await post(token);
      expect(res.status).toBe(401);
    }
    expect(handleGooglePlayNotification).not.toHaveBeenCalled();
  });

  it("afviser et forkert token af samme længde (indholdet tjekkes)", async () => {
    // Vagten på selve vagten: falder denne påstand, tjekker testen ovenfor
    // kun længder igen.
    expect(SAME_LENGTH_TOKEN).toHaveLength(TOKEN.length);
    expect(SAME_LENGTH_TOKEN).not.toBe(TOKEN);

    const res = await post(SAME_LENGTH_TOKEN);

    expect(res.status).toBe(401);
    expect(handleGooglePlayNotification).not.toHaveBeenCalled();
  });

  it("behandler beskeden med det rigtige token", async () => {
    const res = await post(TOKEN);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      received: true,
      outcome: "applied",
    });
    expect(handleGooglePlayNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: expect.objectContaining({ messageId: "pubsub-1" }),
      }),
      expect.anything(),
    );
  });

  it("afviser ugyldig JSON", async () => {
    const res = await post(TOKEN, "{ikke-json");

    expect(res.status).toBe(400);
    expect(handleGooglePlayNotification).not.toHaveBeenCalled();
  });

  it("svarer 500 når behandlingen fejler, så Pub/Sub leverer igen", async () => {
    vi.mocked(handleGooglePlayNotification).mockRejectedValue(
      new Error("Google svarede 503"),
    );

    const res = await post(TOKEN);

    expect(res.status).toBe(500);
    expect(captureRouteError).toHaveBeenCalled();
  });

  it("melder en konto der ikke matcher til Sentry, men svarer 200", async () => {
    vi.mocked(handleGooglePlayNotification).mockResolvedValue({
      outcome: "account_mismatch",
      eventId: "pubsub-1",
      notificationType: "SUBSCRIPTION_PURCHASED",
      subscriptionId: "sub-1",
    } as never);

    const res = await post(TOKEN);

    expect(res.status).toBe(200);
    expect(captureRouteError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: "/api/webhooks/google-play" }),
    );
  });
});
