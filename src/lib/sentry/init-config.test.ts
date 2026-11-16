import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// De tre init-filer (browser, server, edge) skal alle slå tracing, replay og
// persondata fra. Sentry mockes, så testen kun ser de options, filerne giver.
const init = vi.fn();
vi.mock("@sentry/nextjs", () => ({ init }));
vi.mock("@sentry/browser", () => ({
  BrowserClient: class {
    constructor(options: unknown) {
      init(options);
    }
    init() {}
  },
  getCurrentScope: () => ({ setClient() {} }),
  makeFetchTransport: vi.fn(),
  defaultStackParser: vi.fn(),
  globalHandlersIntegration: () => ({ name: "GlobalHandlers" }),
  dedupeIntegration: () => ({ name: "Dedupe" }),
  linkedErrorsIntegration: () => ({ name: "LinkedErrors" }),
  httpContextIntegration: () => ({ name: "HttpContext" }),
}));

const INIT_FILES = {
  browser: () => import("../../instrumentation-client"),
  server: () => import("../../../sentry.server.config"),
  edge: () => import("../../../sentry.edge.config"),
} as const;

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  vi.stubGlobal("window", {
    location: { hostname: "timetrack.dk", origin: "https://timetrack.dk" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(Object.entries(INIT_FILES))("Sentry.init i %s", (_, load) => {
  async function initOptions(): Promise<Record<string, unknown>> {
    await load();
    expect(init).toHaveBeenCalledTimes(1);
    return init.mock.calls[0][0];
  }

  it("slår al dataindsamling fra", async () => {
    const options = await initOptions();

    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: {
          allow: ["host", "rsc", "next-action", "next-router-state-tree"],
        },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("sender hverken traces eller replay", async () => {
    const options = await initOptions();

    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("tracesSampler");
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
    expect(options).not.toHaveProperty("traceLifecycle");
    // v11 kender ikke længere sendDefaultPii; dataCollection afgør alt.
    expect(options).not.toHaveProperty("sendDefaultPii");
    expect(options.sendClientReports).toBe(false);

    const integrations = (options.integrations ?? []) as { name?: string }[];
    expect(integrations.map((i) => i.name)).not.toContain("Replay");
  });
});
