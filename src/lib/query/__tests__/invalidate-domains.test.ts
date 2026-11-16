import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoalescedInvalidator,
  domainsForMutationPath,
  FOCUS_REFRESH_MIN_AGE_MS,
  focusRefetchFor,
  INVOICE_DOMAINS,
  invalidateDomains,
  isFormMirroredQuery,
  orgSharedDomains,
  PREPAID_DOMAINS,
  queryKeyRouter,
  queryMatchesDomains,
  REMOTE_COALESCE_MS,
  remoteInvalidatorFor,
  TIME_ENTRY_DOMAINS,
} from "../invalidate-domains";

function seed(qc: QueryClient, keys: unknown[][]) {
  for (const key of keys) qc.setQueryData(key, { ok: true });
}

function invalidated(qc: QueryClient): string[] {
  return qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => (q.queryKey[0] as string[]).join("."))
    .sort();
}

describe("domainsForMutationPath", () => {
  it("publicerer tid, klippekort og fakturaer med hver deres domæner", () => {
    expect(domainsForMutationPath("time.update")).toBe(TIME_ENTRY_DOMAINS);
    expect(domainsForMutationPath("prepaid.create")).toBe(PREPAID_DOMAINS);
    expect(domainsForMutationPath("invoices.markAsPaid")).toBe(INVOICE_DOMAINS);
  });

  it("publicerer kunder, projekter og opgaver (desktop ser dem live)", () => {
    expect(domainsForMutationPath("clients.archive")).toEqual([
      "clients",
      "projects",
    ]);
    expect(domainsForMutationPath("projects.updateStatus")).toEqual([
      "clients",
      "projects",
    ]);
    expect(domainsForMutationPath("tasks.markDone")).toEqual(["tasks"]);
  });

  it("publicerer ikke timer-heartbeats eller urelaterede routere", () => {
    expect(domainsForMutationPath("timerSync.sync")).toBeNull();
    expect(domainsForMutationPath("user.dismissBanner")).toBeNull();
    expect(domainsForMutationPath("")).toBeNull();
  });

  it("en gemt tidspost rammer saldi, budgetter, dashboard og ufaktureret", () => {
    for (const d of [
      "time",
      "prepaid",
      "clients",
      "projects",
      "dashboard",
      "coverage",
      "invoices",
    ]) {
      expect(TIME_ENTRY_DOMAINS).toContain(d);
    }
  });
});

describe("orgSharedDomains", () => {
  it("sender kun org-delte domæner til kolleger", () => {
    expect(orgSharedDomains(TIME_ENTRY_DOMAINS)).toEqual([
      "prepaid",
      "clients",
      "projects",
      "team",
    ]);
  });
});

describe("queryKeyRouter", () => {
  it("læser routeren fra en tRPC-nøgle", () => {
    expect(queryKeyRouter([["time", "list"], { type: "query" }])).toBe("time");
    expect(queryKeyRouter(["plain"])).toBeNull();
    expect(queryKeyRouter(null)).toBeNull();
  });
});

describe("invalidateDomains", () => {
  it("invaliderer kun queries i de givne domæner", async () => {
    const qc = new QueryClient();
    seed(qc, [
      [["time", "unbilledStats"], { type: "query" }],
      [["clients", "listWithStats"], { type: "query" }],
      [["user", "getProfile"], { type: "query" }],
    ]);
    await invalidateDomains(qc, ["time", "clients"]);
    expect(invalidated(qc)).toEqual([
      "clients.listWithStats",
      "time.unbilledStats",
    ]);
  });

  it('"all" invaliderer alt', async () => {
    const qc = new QueryClient();
    seed(qc, [
      [["time", "list"], { type: "query" }],
      [["user", "getProfile"], { type: "query" }],
    ]);
    await invalidateDomains(qc, "all");
    expect(invalidated(qc)).toEqual(["time.list", "user.getProfile"]);
  });
});

describe("createCoalescedInvalidator", () => {
  afterEach(() => vi.useRealTimers());

  it("samler signaler tæt på hinanden til én invalidering", () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const inv = createCoalescedInvalidator({ invalidateQueries }, 300);
    inv.push(["time"]);
    inv.push(["prepaid", "time"]);
    expect(invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    // Én runde = to kald: almindelige queries + formular-queries uden refetch.
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    const [filters, options] = invalidateQueries.mock.calls[0] as unknown as [
      { predicate: (q: { queryKey: unknown }) => boolean },
      { cancelRefetch: boolean },
    ];
    expect(options).toEqual({ cancelRefetch: false });
    expect(filters.predicate({ queryKey: [["prepaid", "list"]] })).toBe(true);
    expect(filters.predicate({ queryKey: [["user", "x"]] })).toBe(false);
  });

  it('"all" vinder over en domæneliste', () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const inv = createCoalescedInvalidator({ invalidateQueries }, 100);
    inv.push(["time"]);
    inv.push("all");
    vi.advanceTimersByTime(100);
    const [filters, options] = invalidateQueries.mock.calls[0] as unknown as [
      { predicate: (q: { queryKey: unknown }) => boolean },
      { cancelRefetch: boolean },
    ];
    expect(options).toEqual({ cancelRefetch: false });
    expect(filters.predicate({ queryKey: [["user", "x"]] })).toBe(true);
  });
});

describe("focusRefetchFor", () => {
  const now = 1_000_000;
  const q = (path: string[], dataUpdatedAt: number) => ({
    queryKey: [path, { type: "query" }],
    state: { dataUpdatedAt } as never,
  });

  it("henter tidsliste, klippekort og kundeside igen ved fokus", () => {
    const old = now - FOCUS_REFRESH_MIN_AGE_MS;
    expect(focusRefetchFor(q(["time", "list"], old), now)).toBe("always");
    expect(focusRefetchFor(q(["prepaid", "list"], old), now)).toBe("always");
    expect(focusRefetchFor(q(["clients", "listWithStats"], old), now)).toBe(
      "always",
    );
  });

  it("lader formular-queries og helt friske data være", () => {
    const old = now - FOCUS_REFRESH_MIN_AGE_MS;
    expect(focusRefetchFor(q(["time", "getById"], old), now)).toBe(false);
    expect(focusRefetchFor(q(["time", "previewRate"], old), now)).toBe(false);
    expect(focusRefetchFor(q(["user", "getProfile"], old), now)).toBe(false);
    expect(focusRefetchFor(q(["time", "list"], now - 1000), now)).toBe(false);
  });
});

describe("formular-sikker invalidering (review #774, P2-1/P2-2)", () => {
  it("genkender queries der spejles ind i formularer", () => {
    expect(isFormMirroredQuery([["time", "getById"], {}])).toBe(true);
    expect(isFormMirroredQuery([["clients", "getById"], {}])).toBe(true);
    expect(isFormMirroredQuery([["enterprise", "get"], {}])).toBe(true);
    expect(
      isFormMirroredQuery([["enterprise", "getPayrollSettings"], {}]),
    ).toBe(true);
    expect(isFormMirroredQuery([["time", "list"], {}])).toBe(false);
    expect(isFormMirroredQuery([["enterprise", "getBalance"], {}])).toBe(false);
  });

  it("formular-queries markeres forældede men hentes ikke under brugeren", async () => {
    const qc = new QueryClient();
    const fetchDetail = vi.fn(() => Promise.resolve({ v: 2 }));
    const fetchList = vi.fn(() => Promise.resolve([2]));
    // Aktive observers, så en almindelig invalidering ville hente igen.
    const { QueryObserver } = await import("@tanstack/react-query");
    const detail = new QueryObserver(qc, {
      queryKey: [["time", "getById"], { input: { id: "e1" } }],
      queryFn: fetchDetail,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const list = new QueryObserver(qc, {
      queryKey: [["time", "list"], {}],
      queryFn: fetchList,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const u1 = detail.subscribe(() => {});
    const u2 = list.subscribe(() => {});
    await vi.waitFor(() => expect(fetchList).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(1));

    await invalidateDomains(qc, ["time"]);

    expect(fetchList).toHaveBeenCalledTimes(2);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(
      qc
        .getQueryCache()
        .getAll()
        .find((q) => (q.queryKey[0] as string[])[1] === "getById")?.state
        .isInvalidated,
    ).toBe(true);
    u1();
    u2();
  });

  it("enterprise er kun med med de saldo-/anmodningsqueries der skal være friske", () => {
    expect(TIME_ENTRY_DOMAINS).not.toContain("enterprise");
    expect(
      queryMatchesDomains(
        [["enterprise", "getBalance"], {}],
        TIME_ENTRY_DOMAINS,
      ),
    ).toBe(true);
    expect(
      queryMatchesDomains(
        [["enterprise", "listRequests"], {}],
        TIME_ENTRY_DOMAINS,
      ),
    ).toBe(true);
    expect(
      queryMatchesDomains([["enterprise", "get"], {}], TIME_ENTRY_DOMAINS),
    ).toBe(false);
  });

  it("fokus-refetch rører ikke formular-queries", () => {
    const q = {
      queryKey: [["clients", "getById"], {}],
      state: { dataUpdatedAt: 0 } as never,
    };
    expect(focusRefetchFor(q, 1_000_000)).toBe(false);
  });
});

describe("remoteInvalidatorFor", () => {
  afterEach(() => vi.useRealTimers());

  it("samler krydsfane-besked og SSE-event for samme ændring inden for 1 s", () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const inv = remoteInvalidatorFor({ invalidateQueries });
    inv.push(["time"]); // BroadcastChannel
    vi.advanceTimersByTime(700);
    inv.push(["time", "prepaid"]); // SSE lidt senere
    vi.advanceTimersByTime(REMOTE_COALESCE_MS);
    // Én runde: en kald for de almindelige queries + én for formular-queries.
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
