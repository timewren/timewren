// @vitest-environment happy-dom
import type { Event, makeFetchTransport } from "@sentry/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

type Transport = ReturnType<typeof makeFetchTransport>;
type Envelope = Parameters<Transport["send"]>[0];
const envelopes: Envelope[] = [];
const transport: Transport = {
  send: async (envelope) => {
    envelopes.push(envelope);
    return { statusCode: 200 };
  },
  flush: async () => true,
};

vi.mock("@sentry/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/browser")>()),
  makeFetchTransport: () => transport,
}));

afterEach(async () => {
  const Sentry = await import("@sentry/browser");
  await Sentry.getClient()?.close();
  Sentry.getCurrentScope().setClient(undefined);
  envelopes.length = 0;
  vi.unstubAllEnvs();
});

describe.each(["/", "/dashboard"])("browser errors on %s", (route) => {
  it("sends an exception with a stack and environment through the real SDK", async () => {
    vi.resetModules();
    window.location.href = `https://timetrack.dk${route}`;
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.com/1");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_BROWSER_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    await import("../../instrumentation-client");
    const Sentry = await import("@sentry/browser");
    Sentry.captureException(new Error(`Client failure on ${route}`));
    await Sentry.flush(2000);

    const events = envelopes.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "event")
        .map(([, body]) => body),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      environment: "production",
      exception: {
        values: [
          {
            type: "Error",
            value: `Client failure on ${route}`,
            stacktrace: { frames: expect.any(Array) },
          },
        ],
      },
    });
    const event = events[0] as Event;
    expect(
      event.exception?.values?.[0].stacktrace?.frames?.length,
    ).toBeGreaterThan(0);
    expect(
      envelopes.flatMap(([, items]) => items.map(([header]) => header.type)),
    ).toEqual(["event"]);
    expect(
      Sentry.getClient()
        ?.getOptions()
        .integrations.map((i) => i.name),
    ).toEqual(["GlobalHandlers", "Dedupe", "LinkedErrors", "HttpContext"]);
  });
});

it("captures an uncaught browser error in beta through the global handler", async () => {
  vi.resetModules();
  window.location.href = "https://beta.timetrack.dk/dashboard";
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.com/1");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_BROWSER_ENABLED", "true");
  await import("../../instrumentation-client");
  const Sentry = await import("@sentry/browser");
  const error = new Error("Uncaught beta error");
  window.onerror?.("Uncaught beta error", window.location.href, 1, 1, error);
  await Sentry.flush(2000);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0][1][0][1]).toMatchObject({
    environment: "beta",
    exception: {
      values: [{ value: "Uncaught beta error", mechanism: { handled: false } }],
    },
  });
});

it("keeps browser reporting disabled when the feature flag is false", async () => {
  vi.resetModules();
  window.location.href = "https://timetrack.dk/";
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.com/1");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_BROWSER_ENABLED", "false");
  await import("../../instrumentation-client");
  const Sentry = await import("@sentry/browser");
  Sentry.captureException(new Error("Disabled"));
  await Sentry.flush(2000);
  expect(envelopes).toEqual([]);
});
