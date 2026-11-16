import { beforeAll, describe, expect, it, vi } from "vitest";

// Kører den rigtige Sentry.init fra sentry.server.config.ts. Kun DSN og
// transport skiftes ud, så intet forlader maskinen, og testen ser præcis de
// envelopes, serveren ville sende.
type Envelope = [unknown, [{ type: string }, unknown][]];
const envelopes: Envelope[] = [];

vi.mock("@sentry/nextjs", async (importOriginal) => {
  // Node's CJS-lexer ser ikke SDK'ets videreeksporter fra @sentry/node, så
  // det fulde API ligger kun på default.
  type Sdk = typeof import("@sentry/nextjs");
  const module = await importOriginal<Sdk & { default?: Sdk }>();
  const actual = module.default ?? module;
  return {
    ...actual,
    init: (options: Parameters<typeof actual.init>[0]) =>
      actual.init({
        ...options,
        dsn: "https://public@sentry.invalid/1",
        transport: () => ({
          send: async (envelope: Envelope) => {
            envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      }),
  };
});

const Sentry = await import("@sentry/nextjs");

// Request, som Next-SDK'et lægger den på scopet (wrapRouteHandlerWithSentry,
// captureRequestError), med alt det, v11 ellers sender med: cookies, en body,
// query-parametre og identificerende headere.
const NORMALIZED_REQUEST = {
  method: "POST",
  url: "https://timetrack.dk/api/trpc/time.create?email=someone%40example.org",
  query_string: "email=someone%40example.org",
  headers: {
    host: "timetrack.dk",
    rsc: "1",
    cookie: "theme=dark; locale=da",
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64)",
    "x-forwarded-for": "203.0.113.7",
    referer: "https://timetrack.dk/dashboard?client=acme",
  },
  cookies: { theme: "dark", locale: "da" },
  data: '{"description":"Møde med kunden"}',
};

// Værdien opstår først ved runtime. Kildelinjerne omkring en frame sendes
// (frameContextLines), så en strenglitteral her ville altid dukke op.
const LOCAL_VALUE = `lokal-${process.pid}`;

function failWithLocals(): never {
  const description = LOCAL_VALUE.toUpperCase();
  throw new Error(`kunne ikke gemme (${description.length})`);
}

type SentItem = { type: string; payload: Record<string, unknown> };

function sentItems(): SentItem[] {
  return envelopes.flatMap(([, items]) =>
    items.map(([header, payload]) => ({
      type: header.type,
      payload: payload as Record<string, unknown>,
    })),
  );
}

function sentEvent(): Record<string, unknown> {
  const event = sentItems().find((item) => item.type === "event")?.payload;
  if (!event) throw new Error("Sentry sendte intet event");
  return event;
}

describe("Sentry på serveren", () => {
  beforeAll(async () => {
    await import("../../../sentry.server.config");

    Sentry.withIsolationScope((scope) => {
      scope.setSDKProcessingMetadata({
        normalizedRequest: NORMALIZED_REQUEST,
        ipAddress: "203.0.113.7",
      });
      Sentry.setUser({ id: "user-1" });
      // Selv kode, der beder om et span, må ikke give tracing-data.
      Sentry.startSpan(
        { name: "trpc.time.create", op: "trpc.mutation" },
        () => {
          try {
            failWithLocals();
          } catch (error) {
            Sentry.captureException(error);
          }
        },
      );
    });

    // close tømmer også sessioner og client reports, så de kommer med her.
    await Sentry.close(2000);
  });

  it("sender kun envelopes af typen event", () => {
    // En release-health-session pr. proces kommer med, når SDK'et finder et
    // release (fx GITHUB_SHA i CI); den bærer ingen request- eller brugerdata.
    const types = sentItems()
      .map((item) => item.type)
      .filter((type) => type !== "session");
    expect(types).toEqual(["event"]);
  });

  it("sender ingen cookies, body eller query-parametre", () => {
    const request = sentEvent().request as Record<string, unknown>;

    expect(request.method).toBe("POST");
    expect(request).not.toHaveProperty("cookies");
    expect(request).not.toHaveProperty("data");
    expect(request.query_string).toBeUndefined();
    expect(String(request.url)).not.toContain("example.org");
  });

  it("sender kun de headere, støjfiltrene skal bruge", () => {
    const request = sentEvent().request as Record<string, unknown>;
    const headers = request.headers as Record<string, string>;

    expect(headers.host).toBe("timetrack.dk");
    expect(headers.rsc).toBe("1");
    for (const name of ["cookie", "user-agent", "x-forwarded-for", "referer"]) {
      expect([undefined, "[Filtered]"]).toContain(headers[name]);
    }
  });

  it("sender ingen lokale variabler, IP eller persondata", () => {
    const event = sentEvent();
    const frames = (
      event.exception as {
        values: { stacktrace?: { frames?: Record<string, unknown>[] } }[];
      }
    ).values.flatMap((value) => value.stacktrace?.frames ?? []);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => "vars" in frame)).toEqual([]);
    // Brugerens id sætter appen selv (trpc.ts); IP'en må ikke udledes.
    expect(event.user).toEqual({ id: "user-1" });

    const serialized = JSON.stringify(event);
    for (const secret of [
      LOCAL_VALUE.toUpperCase(),
      "example.org",
      "203.0.113.7",
      "theme",
      "Mozilla",
      "acme",
      "Møde med kunden",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
