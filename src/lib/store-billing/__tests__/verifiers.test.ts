import { generateKeyPairSync } from "node:crypto";
import {
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppleVerifier, peekAppleEnvironment } from "../apple";
import { APPLE_ROOT_CERTS_BASE64 } from "../apple-root-certs";
import {
  createGooglePlayClient,
  GooglePlayPurchaseNotFoundError,
} from "../google";

const b64url = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString(
    "base64url",
  );

function fakeJws(payload: object, x5c: string[]): string {
  return [
    b64url({ alg: "ES256", x5c }),
    b64url(payload),
    Buffer.from("ikke-en-signatur").toString("base64url"),
  ].join(".");
}

const TX_PAYLOAD = {
  originalTransactionId: "2000000111",
  transactionId: "2000000111",
  bundleId: "dk.timetrack.app",
  productId: "dk.timetrack.app.solo.monthly",
  environment: "Production",
  signedDate: Date.now(),
  expiresDate: Date.now() + 86_400_000,
};

describe("Apple-verifier (rigtige rodcertifikater, ingen netværk)", () => {
  const verifier = createAppleVerifier();
  const g3 = APPLE_ROOT_CERTS_BASE64["AppleRootCA-G3"];

  it("afviser en JWS uden certifikatkæde", async () => {
    const err = await verifier
      .verifyTransaction(fakeJws(TX_PAYLOAD, []))
      .catch((e) => e);
    expect(err).toBeInstanceOf(VerificationException);
    // Biblioteket pakker kædelængde-fejlen ind som INVALID_CERTIFICATE.
    expect(err.status).toBe(VerificationStatus.INVALID_CERTIFICATE);
  });

  it("afviser en kæde der ikke er udstedt til App Store (forfalsket leaf)", async () => {
    // Apples rod som både leaf og intermediate: kæden "verificerer", men
    // mangler Apples App Store-OID'er og skal afvises før enhver signatur.
    const err = await verifier
      .verifyTransaction(fakeJws(TX_PAYLOAD, [g3, g3, g3]))
      .catch((e) => e);
    expect(err).toBeInstanceOf(VerificationException);
    expect(err.status).toBe(VerificationStatus.VERIFICATION_FAILURE);
  });

  it("afviser vrøvl og en forfalsket notifikation", async () => {
    await expect(verifier.verifyTransaction("vrøvl")).rejects.toBeInstanceOf(
      VerificationException,
    );
    const notification = fakeJws(
      {
        notificationType: "DID_RENEW",
        notificationUUID: "u-1",
        signedDate: Date.now(),
        data: {
          bundleId: "dk.timetrack.app",
          appAppleId: 6812371822,
          environment: "Production",
          signedTransactionInfo: "x",
        },
      },
      [g3, g3, g3],
    );
    await expect(
      verifier.verifyNotification(notification),
    ).rejects.toBeInstanceOf(VerificationException);
  });

  it("vælger miljø ud fra payload (Sandbox/Production)", () => {
    expect(peekAppleEnvironment(fakeJws({ environment: "Sandbox" }, []))).toBe(
      "Sandbox",
    );
    expect(
      peekAppleEnvironment(fakeJws({ data: { environment: "Sandbox" } }, [])),
    ).toBe("Sandbox");
    expect(peekAppleEnvironment(fakeJws({}, []))).toBe("Production");
    expect(peekAppleEnvironment("vrøvl")).toBe("Production");
  });
});

describe("Google Play-klient (fetch injiceret)", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const envBefore = { ...process.env };

  afterEach(() => {
    process.env = { ...envBefore };
  });

  function setup(responses: Array<{ status: number; body?: unknown }>) {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = Buffer.from(
      JSON.stringify({
        client_email: "billing@timetrack.iam.gserviceaccount.com",
        private_key: pem,
      }),
    ).toString("base64");
    process.env.GOOGLE_PLAY_PACKAGE_NAME = "dk.timetrack.app";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const queue = [...responses];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "at-1", expires_in: 3600 }),
          { status: 200 },
        );
      }
      const next = queue.shift() ?? { status: 500 };
      return new Response(
        next.body === undefined ? null : JSON.stringify(next.body),
        { status: next.status },
      );
    }) as unknown as typeof fetch;
    return { client: createGooglePlayClient(fetchImpl), calls };
  }

  it("henter købet med et servicekonto-token og acknowledger", async () => {
    const { client, calls } = setup([
      { status: 200, body: { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" } },
      { status: 200, body: {} },
    ]);
    await expect(client.getSubscription("tok/1")).resolves.toEqual({
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    });
    await client.acknowledge("solo", "tok/1");

    const tokenCall = calls[0];
    expect(tokenCall.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(tokenCall.init?.body));
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const claims = JSON.parse(
      Buffer.from(
        (form.get("assertion") ?? "").split(".")[1],
        "base64url",
      ).toString(),
    );
    expect(claims).toMatchObject({
      iss: "billing@timetrack.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/androidpublisher",
    });

    const apiCalls = calls.filter((c) => c.url.includes("androidpublisher"));
    expect(apiCalls[0].url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/dk.timetrack.app/purchases/subscriptionsv2/tokens/tok%2F1",
    );
    expect(apiCalls[1].url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/dk.timetrack.app/purchases/subscriptions/solo/tokens/tok%2F1:acknowledge",
    );
    expect(apiCalls[1].init?.method).toBe("POST");
    for (const c of apiCalls) {
      expect(new Headers(c.init?.headers).get("authorization")).toBe(
        "Bearer at-1",
      );
    }
    // Tokenet genbruges (én OAuth-udveksling for to kald).
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
  });

  it("alle kald til Google har en timeout, så et hængende kald ikke blokerer", async () => {
    const { client, calls } = setup([
      { status: 200, body: { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" } },
      { status: 200, body: {} },
    ]);
    await client.getSubscription("tok");
    await client.acknowledge("solo", "tok");

    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "oauth2.googleapis.com",
      "androidpublisher.googleapis.com",
      "androidpublisher.googleapis.com",
    ]);
    for (const c of calls) {
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
      expect(c.init?.signal?.aborted).toBe(false);
    }
  });

  it("ukendt token → GooglePlayPurchaseNotFoundError; andre fejl kastes", async () => {
    const { client } = setup([{ status: 410 }, { status: 503 }]);
    await expect(client.getSubscription("x")).rejects.toBeInstanceOf(
      GooglePlayPurchaseNotFoundError,
    );
    await expect(client.getSubscription("x")).rejects.toThrow(/HTTP 503/);
  });

  it("fejler tydeligt uden servicekonto", async () => {
    const client = createGooglePlayClient(vi.fn() as unknown as typeof fetch);
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    await expect(client.getSubscription("x")).rejects.toThrow(
      /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/,
    );
  });
});
