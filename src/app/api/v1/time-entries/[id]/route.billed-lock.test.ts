import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/engagement", () => ({ sendFirstTimeEntryEmail: vi.fn() }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// REST-ruterne kalder time-routeren gennem nøglens tRPC-caller. Vi bytter
// kun API-nøgle-opslaget ud; fejl-mapningen (handleTrpcError) er den rigtige.
const apiCaller = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/api/middleware", async () => {
  const http =
    await vi.importActual<typeof import("@/lib/api/http")>("@/lib/api/http");
  return {
    ...http,
    authenticateApiKey: async () => ({
      context: {
        userId: "user-billed-lock",
        scopes: ["*"],
        apiKeyId: "key-1",
        caller: apiCaller.current,
        rateLimit: { limit: 100, remaining: 99, reset: 0 },
      },
    }),
    requireScope: () => null,
  };
});

import {
  BL_ENTRY_ID,
  entryRow,
  makeTimeCaller,
  makeTimeDb,
} from "@/test/billed-entry-mocks";
import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: BL_ENTRY_ID }) };

function request(body?: unknown): NextRequest {
  return new Request(
    `https://timetrack.test/api/v1/time-entries/${BL_ENTRY_ID}`,
    {
      method: body ? "PATCH" : "DELETE",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
  ) as unknown as NextRequest;
}

describe("REST /api/v1/time-entries/[id] — fakturerede poster (#702)", () => {
  let db: ReturnType<typeof makeTimeDb>["db"];

  beforeEach(() => {
    db = makeTimeDb([entryRow()]).db;
    apiCaller.current = makeTimeCaller(db);
  });

  it("DELETE svarer 403 med dansk forklaring og sletter intet", async () => {
    const res = await DELETE(request(), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("Kreditér fakturaen");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("PATCH af timer svarer 403 og skriver intet", async () => {
    const res = await PATCH(request({ hours: 5 }), params);
    expect(res.status).toBe(403);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("PATCH af kun noten er tilladt", async () => {
    const res = await PATCH(request({ notes: "Intern note" }), params);
    expect(res.status).toBe(200);
  });
});
