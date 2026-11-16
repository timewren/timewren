import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  pickDefaultBillable,
  resolveDefaultBillable,
} from "../default-billable";

type MockDb = Parameters<typeof resolveDefaultBillable>[0];

function makeDb(opts: {
  client?: { defaultBillable: boolean } | undefined;
  project?: { client: { defaultBillable: boolean } | null } | undefined;
  activityType?: { defaultBillable: boolean | null } | undefined;
}) {
  return {
    query: {
      clients: { findFirst: vi.fn(async () => opts.client) },
      projects: { findFirst: vi.fn(async () => opts.project) },
      activityTypes: { findFirst: vi.fn(async () => opts.activityType) },
    },
  } as unknown as MockDb & {
    query: {
      clients: { findFirst: ReturnType<typeof vi.fn> };
      projects: { findFirst: ReturnType<typeof vi.fn> };
      activityTypes: { findFirst: ReturnType<typeof vi.fn> };
    };
  };
}

describe("resolveDefaultBillable", () => {
  it("returns the explicit value untouched, even for an internal client", async () => {
    const db = makeDb({ client: { defaultBillable: false } });
    await expect(
      resolveDefaultBillable(db, { clientId: "c1" }, true),
    ).resolves.toBe(true);
    await expect(
      resolveDefaultBillable(db, { clientId: "c1" }, false),
    ).resolves.toBe(false);
    expect(db.query.clients.findFirst).not.toHaveBeenCalled();
  });

  it("inherits false from the client when clientId is set", async () => {
    const db = makeDb({ client: { defaultBillable: false } });
    await expect(
      resolveDefaultBillable(db, { clientId: "c1", projectId: "p1" }),
    ).resolves.toBe(false);
    expect(db.query.projects.findFirst).not.toHaveBeenCalled();
  });

  it("inherits true from a normal client", async () => {
    const db = makeDb({ client: { defaultBillable: true } });
    await expect(
      resolveDefaultBillable(db, { clientId: "c1" }, undefined),
    ).resolves.toBe(true);
  });

  it("inherits from the project's client when only projectId is set", async () => {
    const db = makeDb({ project: { client: { defaultBillable: false } } });
    await expect(
      resolveDefaultBillable(db, { projectId: "p1" }, null),
    ).resolves.toBe(false);
  });

  it("defaults to true without project/client (intern tid) or unknown ids", async () => {
    await expect(resolveDefaultBillable(makeDb({}), {})).resolves.toBe(true);
    await expect(
      resolveDefaultBillable(makeDb({}), { clientId: "missing" }),
    ).resolves.toBe(true);
    await expect(
      resolveDefaultBillable(makeDb({ project: { client: null } }), {
        projectId: "p1",
      }),
    ).resolves.toBe(true);
  });
});

describe("pickDefaultBillable (#704 precedence)", () => {
  it("explicit choice beats everything", () => {
    expect(
      pickDefaultBillable({
        explicit: true,
        clientDefaultBillable: false,
        activityTypeDefaultBillable: false,
        fallback: false,
      }),
    ).toBe(true);
    expect(
      pickDefaultBillable({
        explicit: false,
        clientDefaultBillable: true,
        activityTypeDefaultBillable: true,
      }),
    ).toBe(false);
  });

  it("an internal client beats a billable activity type", () => {
    expect(
      pickDefaultBillable({
        clientDefaultBillable: false,
        activityTypeDefaultBillable: true,
      }),
    ).toBe(false);
  });

  it("the activity type beats a normal client and the fallback", () => {
    expect(
      pickDefaultBillable({
        clientDefaultBillable: true,
        activityTypeDefaultBillable: false,
      }),
    ).toBe(false);
    expect(
      pickDefaultBillable({
        clientDefaultBillable: true,
        activityTypeDefaultBillable: true,
        fallback: false,
      }),
    ).toBe(true);
  });

  it("null activity type inherits the fallback (default true)", () => {
    expect(
      pickDefaultBillable({
        clientDefaultBillable: true,
        activityTypeDefaultBillable: null,
      }),
    ).toBe(true);
    expect(
      pickDefaultBillable({
        clientDefaultBillable: true,
        activityTypeDefaultBillable: null,
        fallback: false,
      }),
    ).toBe(false);
    expect(pickDefaultBillable({})).toBe(true);
  });
});

describe("resolveDefaultBillable with activity types (#704)", () => {
  it("uses the activity type's default on a normal client", async () => {
    const db = makeDb({
      client: { defaultBillable: true },
      activityType: { defaultBillable: false },
    });
    await expect(
      resolveDefaultBillable(db, { clientId: "c1", activityTypeId: "a1" }),
    ).resolves.toBe(false);
  });

  it("does not look up the activity type for an internal client", async () => {
    const db = makeDb({
      project: { client: { defaultBillable: false } },
      activityType: { defaultBillable: true },
    });
    await expect(
      resolveDefaultBillable(db, { projectId: "p1", activityTypeId: "a1" }),
    ).resolves.toBe(false);
    expect(db.query.activityTypes.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the caller's default when the type inherits", async () => {
    const db = makeDb({
      client: { defaultBillable: true },
      activityType: { defaultBillable: null },
    });
    await expect(
      resolveDefaultBillable(
        db,
        { clientId: "c1", activityTypeId: "a1" },
        undefined,
        { fallback: false },
      ),
    ).resolves.toBe(false);
  });

  it("a billable activity type overrides the timesheet fallback", async () => {
    const db = makeDb({
      client: { defaultBillable: true },
      activityType: { defaultBillable: true },
    });
    await expect(
      resolveDefaultBillable(
        db,
        { clientId: "c1", activityTypeId: "a1" },
        null,
        { fallback: false },
      ),
    ).resolves.toBe(true);
  });
});
