import type { Event, EventHint } from "@sentry/nextjs";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";

import {
  shouldDropLocalhostEvent,
  shouldDropMalformedRouterStateEvent,
  shouldDropThirdPartyScriptEvent,
  shouldDropUnhandledTrpcRejection,
  withoutRequestBody,
} from "@/lib/utils/sentry-filter";

function event(headers: NonNullable<Event["request"]>["headers"]): Event {
  return {
    exception: {
      values: [
        {
          type: "Error",
          value: "The router state header was sent but could not be parsed.",
        },
      ],
    },
    request: {
      method: "POST",
      headers,
    },
  } as Event;
}

describe("shouldDropMalformedRouterStateEvent", () => {
  it("drops the malformed Next router-state probe seen in Sentry", () => {
    expect(
      shouldDropMalformedRouterStateEvent(
        event({
          Rsc: "1",
          "Next-Action": "x",
          "Next-Router-State-Tree": '[""]',
        }),
      ),
    ).toBe(true);
  });

  it("drops encoded malformed router-state probes", () => {
    expect(
      shouldDropMalformedRouterStateEvent(
        event({
          rsc: "1",
          "next-action": "x",
          "next-router-state-tree": "%5b%22%22%5d",
        }),
      ),
    ).toBe(true);
  });

  it("keeps plausible server action events with a real action id", () => {
    expect(
      shouldDropMalformedRouterStateEvent(
        event({
          rsc: "1",
          "next-action": "0064f4d0f0fbfef9b155a84f99bcf82f0f6ec313d8",
          "next-router-state-tree": "%5B%22%22%5D",
        }),
      ),
    ).toBe(false);
  });

  it("dropper navigationer og prefetches fra en fane med en gammel build (GET)", () => {
    const navigation = event({
      rsc: "1",
      "next-router-state-tree":
        "%5B%22%22%2C%7B%22children%22%3A%5B%22dashboard%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
    });
    navigation.request = { ...navigation.request, method: "GET" };
    expect(shouldDropMalformedRouterStateEvent(navigation)).toBe(true);
  });

  it("beholder GET-forespørgsler uden RSC-header", () => {
    const plain = event({ "next-router-state-tree": "x" });
    plain.request = { ...plain.request, method: "GET" };
    expect(shouldDropMalformedRouterStateEvent(plain)).toBe(false);
  });

  it("keeps other errors", () => {
    const otherEvent = event({
      rsc: "1",
      "next-action": "x",
      "next-router-state-tree": '[""]',
    });
    otherEvent.exception = {
      values: [{ type: "Error", value: "Database unavailable" }],
    };

    expect(shouldDropMalformedRouterStateEvent(otherEvent)).toBe(false);
  });
});

describe("shouldDropLocalhostEvent", () => {
  it("drops errors captured from local smoke-test requests", () => {
    expect(
      shouldDropLocalhostEvent({
        request: {
          url: "http://localhost:3100/api/trpc/roadmap.getAll",
          headers: { Host: "localhost:3100" },
        },
      } as Event),
    ).toBe(true);
  });

  it("drops loopback host headers when the request URL is missing", () => {
    expect(
      shouldDropLocalhostEvent({
        request: { headers: { host: "127.0.0.1:3000" } },
      } as Event),
    ).toBe(true);
  });

  it("drops IPv6 loopback host headers", () => {
    expect(
      shouldDropLocalhostEvent({
        request: { headers: { host: "[::1]:3000" } },
      } as Event),
    ).toBe(true);
  });

  it("drops IPv6 loopback URLs without a host header", () => {
    expect(
      shouldDropLocalhostEvent({
        request: { url: "http://[::1]:3000/api/trpc/roadmap.getAll" },
      } as Event),
    ).toBe(true);
  });

  it("keeps non-IP hostnames that start with 127", () => {
    expect(
      shouldDropLocalhostEvent({
        request: { url: "https://127.example.com/api/trpc/roadmap.getAll" },
      } as Event),
    ).toBe(false);
  });

  it("keeps invalid IPv4-shaped hostnames", () => {
    expect(
      shouldDropLocalhostEvent({
        request: { headers: { host: "127.999.0.1:3000" } },
      } as Event),
    ).toBe(false);
  });

  it("keeps real production hosts", () => {
    expect(
      shouldDropLocalhostEvent({
        request: {
          url: "https://timetrack.dk/api/trpc/roadmap.getAll",
          headers: { Host: "timetrack.dk" },
        },
      } as Event),
    ).toBe(false);
  });
});

describe("withoutRequestBody", () => {
  it("removes the request body but keeps the rest of the request", () => {
    const filtered = withoutRequestBody({
      message: "fejl",
      request: {
        method: "POST",
        url: "https://timetrack.dk/api/v1/time-entries",
        data: { description: "Møde med kunden" },
      },
    } as Event);

    expect(filtered.request).toEqual({
      method: "POST",
      url: "https://timetrack.dk/api/v1/time-entries",
    });
    expect(filtered.message).toBe("fejl");
  });

  it("returns the same event when there is no body", () => {
    const original = { request: { method: "GET" } } as Event;

    expect(withoutRequestBody(original)).toBe(original);
  });
});

describe("shouldDropThirdPartyScriptEvent", () => {
  const origin = "https://timetrack.dk";

  function browserEvent(value: string, frames: string[] = []): Event {
    return {
      exception: {
        values: [
          {
            type: "Error",
            value,
            stacktrace: frames.length
              ? { frames: frames.map((filename) => ({ filename })) }
              : undefined,
          },
        ],
      },
    } as Event;
  }

  it("dropper Googles API-script, som TimeTrack ikke selv indlæser (TIMETRACK-1V)", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent(
          "Failed to load script: https://apis.google.com/js/client.js",
        ),
        origin,
      ),
    ).toBe(true);
  });

  it("dropper fejl, hvis stack kun ligger i browserudvidelser og fremmede scripts", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("x is undefined", [
          "chrome-extension://abc/content.js",
          "https://apis.google.com/js/client.js",
        ]),
        origin,
      ),
    ).toBe(true);
  });

  it("beholder fejl med mindst én ramme fra TimeTrack selv", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("x is undefined", [
          "chrome-extension://abc/content.js",
          "https://timetrack.dk/_next/static/chunks/app.js",
        ]),
        origin,
      ),
    ).toBe(false);
  });

  it("dropper browserens maskerede 'Script error.', også med sidens URL som ramme (TIMETRACK-24)", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("Script error.", ["/arbejdstimer-pr-maaned"]),
        origin,
      ),
    ).toBe(true);
    expect(
      shouldDropThirdPartyScriptEvent(
        { message: "Script error." } as Event,
        origin,
      ),
    ).toBe(true);
  });

  it("beholder egne fejl, der blot nævner 'Script error'", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("Script error ved indlæsning af rapport"),
        origin,
      ),
    ).toBe(false);
  });

  it("dropper fejl fra udvidelsers runtime-API uden egne rammer (TIMETRACK-25)", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("Invalid call to runtime.sendMessage(). Tab not found."),
        origin,
      ),
    ).toBe(true);
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("Extension context invalidated."),
        origin,
      ),
    ).toBe(true);
  });

  it("beholder runtime-API-fejl med en ramme fra TimeTrack selv", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("Invalid call to runtime.sendMessage(). Tab not found.", [
          "https://timetrack.dk/_next/static/chunks/app.js",
        ]),
        origin,
      ),
    ).toBe(false);
  });

  it("beholder egne fejl uden stack", () => {
    expect(
      shouldDropThirdPartyScriptEvent(
        browserEvent("CVR opslag fejlede"),
        origin,
      ),
    ).toBe(false);
  });
});

describe("shouldDropUnhandledTrpcRejection", () => {
  function rejection(mechanism: string): Event {
    return {
      exception: {
        values: [
          {
            type: "TRPCClientError",
            value: "x",
            mechanism: { type: mechanism, handled: false },
          },
        ],
      },
    } as Event;
  }
  const unhandled = "auto.browser.global_handlers.onunhandledrejection";
  const serverRejection = TRPCClientError.from({
    error: {
      message: "Gratis har plads til 3 aktive kunder",
      code: -32003,
      data: { code: "FORBIDDEN", httpStatus: 403 },
    },
  });
  const networkRejection = TRPCClientError.from(
    new TypeError("NetworkError when attempting to fetch resource."),
  );

  it("dropper ufangede afvisninger fra mutateAsync, som onError allerede viser (TIMETRACK-1T)", () => {
    const hint: EventHint = { originalException: networkRejection };
    expect(shouldDropUnhandledTrpcRejection(rejection(unhandled), hint)).toBe(
      true,
    );
    expect(
      shouldDropUnhandledTrpcRejection(rejection(unhandled), {
        originalException: serverRejection,
      }),
    ).toBe(true);
  });

  it("beholder tRPC-fejl uden svar fra serveren, fx et svar der ikke kunne læses", () => {
    const parseError = TRPCClientError.from(
      new Error("Unable to transform response from server"),
    );
    expect(
      shouldDropUnhandledTrpcRejection(rejection(unhandled), {
        originalException: parseError,
      }),
    ).toBe(false);
  });

  it("beholder fejl fanget af en error boundary og andre fejltyper", () => {
    expect(
      shouldDropUnhandledTrpcRejection(rejection("generic"), {
        originalException: serverRejection,
      }),
    ).toBe(false);
    expect(
      shouldDropUnhandledTrpcRejection(rejection(unhandled), {
        originalException: new Error("Failed to fetch"),
      }),
    ).toBe(false);
  });
});
