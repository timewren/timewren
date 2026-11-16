/**
 * App Store-webhooken (#1113): rutens egne beslutninger om en
 * abonnements-notifikation — mørk uden STORE_BILLING_ENABLED, 400 på ugyldig
 * signatur og 500 (så Apple leverer igen) ved forbigående fejl. Selve
 * tilstandsskiftet testes mod rigtig Postgres i
 * src/lib/store-billing/__tests__/store-billing.integration.test.ts.
 */
import {
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/store-billing/apple", () => ({
  getAppleVerifier: () => ({ verifyNotification: vi.fn() }),
}));
// isStoreBillingEnabled er den rigtige (env-gaten er netop det, der testes);
// kun selve behandlingen erstattes.
vi.mock("@/lib/store-billing/service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  handleAppleNotification: vi.fn(),
}));

import { handleAppleNotification } from "@/lib/store-billing/service";
import { captureRouteError } from "@/lib/utils/sentry";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/webhooks/app-store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const outcome = (over: Record<string, unknown> = {}) => ({
  outcome: "applied",
  eventId: "apple-event-1",
  notificationType: "DID_RENEW",
  subscriptionId: "sub-1",
  ...over,
});

beforeEach(() => {
  vi.stubEnv("STORE_BILLING_ENABLED", "1");
  vi.mocked(handleAppleNotification).mockResolvedValue(outcome() as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("App Store-webhook", () => {
  it("er mørk (404) indtil STORE_BILLING_ENABLED=1", async () => {
    vi.stubEnv("STORE_BILLING_ENABLED", "");

    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(404);
    expect(handleAppleNotification).not.toHaveBeenCalled();
  });

  it("behandler en notifikation og svarer med udfaldet", async () => {
    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      received: true,
      outcome: "applied",
    });
    expect(handleAppleNotification).toHaveBeenCalledWith(
      expect.anything(),
      "jws",
      expect.anything(),
    );
  });

  it("afviser en krop uden signedPayload", async () => {
    for (const body of [{}, { signedPayload: "" }, { signedPayload: 42 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(handleAppleNotification).not.toHaveBeenCalled();
  });

  it("afviser ugyldig JSON", async () => {
    const res = await post("{ikke-json");

    expect(res.status).toBe(400);
    expect(handleAppleNotification).not.toHaveBeenCalled();
  });

  it("svarer 400 når Apple-signaturen ikke kan verificeres", async () => {
    vi.mocked(handleAppleNotification).mockRejectedValue(
      new VerificationException(VerificationStatus.INVALID_CERTIFICATE),
    );

    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(400);
    expect(captureRouteError).toHaveBeenCalled();
  });

  it("svarer 500 på en forbigående verifikationsfejl, så Apple leverer igen", async () => {
    vi.mocked(handleAppleNotification).mockRejectedValue(
      new VerificationException(
        VerificationStatus.RETRYABLE_VERIFICATION_FAILURE,
      ),
    );

    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(500);
  });

  it("svarer 500 når behandlingen fejler", async () => {
    vi.mocked(handleAppleNotification).mockRejectedValue(
      new Error("databasen er nede"),
    );

    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(500);
    expect(captureRouteError).toHaveBeenCalled();
  });

  it("melder en konto der ikke matcher til Sentry, men svarer 200", async () => {
    vi.mocked(handleAppleNotification).mockResolvedValue(
      outcome({ outcome: "account_mismatch" }) as never,
    );

    const res = await post({ signedPayload: "jws" });

    expect(res.status).toBe(200);
    expect(captureRouteError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: "/api/webhooks/app-store" }),
    );
  });
});
