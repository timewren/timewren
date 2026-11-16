import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

// Mock modules that trigger a DB connection on import
vi.mock("@/lib/db", () => ({
  db: {},
}));

import {
  TEST_CLIENT_ID,
  TEST_CLIENT_ID_2,
  TEST_USER_ID,
} from "@/test/fixtures";
import { assertClientAccess, getAccessibleClientIds } from "../clientAccess";

type Membership = { id: string; role: string } | undefined;

/**
 * Minimal stand-in for the Drizzle query builder surface that
 * getAccessibleClientIds touches.
 */
function makeDb(opts: {
  membership?: Membership;
  restrictClientAccess?: boolean;
  grantedClientIds?: string[];
}) {
  return {
    query: {
      members: {
        findFirst: vi.fn().mockResolvedValue(opts.membership),
      },
      organizations: {
        findFirst: vi.fn().mockResolvedValue({
          metadata: JSON.stringify(
            opts.restrictClientAccess === undefined
              ? {}
              : { restrictClientAccess: opts.restrictClientAccess },
          ),
        }),
      },
      memberClientAccess: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            (opts.grantedClientIds ?? []).map((clientId) => ({ clientId })),
          ),
      },
    },
  } as unknown as Parameters<typeof getAccessibleClientIds>[0];
}

const ORG_ID = "org-0000-0000-0000-000000000001";

describe("getAccessibleClientIds", () => {
  it("giver ingen adgang til en bruger uden medlemskab i orgen", async () => {
    const db = makeDb({ membership: undefined });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toEqual([]);
  });

  it("lader ejeren se alle klienter (null = ubegrænset)", async () => {
    const db = makeDb({ membership: { id: "m1", role: "owner" } });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toBeNull();
  });

  it("lader admin se alle klienter", async () => {
    const db = makeDb({ membership: { id: "m1", role: "admin" } });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toBeNull();
  });

  it("begrænser ikke et menigt medlem når orgen ikke har slået restriktionen til", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      grantedClientIds: [TEST_CLIENT_ID],
    });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toBeNull();
  });

  it("returnerer kun tildelte klienter når restriktionen er slået til", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      restrictClientAccess: true,
      grantedClientIds: [TEST_CLIENT_ID],
    });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toEqual([TEST_CLIENT_ID]);
  });

  it("returnerer tom liste når et begrænset medlem intet har fået tildelt", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      restrictClientAccess: true,
      grantedClientIds: [],
    });
    await expect(
      getAccessibleClientIds(db, TEST_USER_ID, ORG_ID),
    ).resolves.toEqual([]);
  });
});

describe("assertClientAccess", () => {
  it("er en no-op for solo-brugere uden org", async () => {
    const db = makeDb({ membership: undefined });
    await expect(
      assertClientAccess(db, TEST_USER_ID, null, TEST_CLIENT_ID),
    ).resolves.toBeUndefined();
  });

  it("slipper ejeren igennem", async () => {
    const db = makeDb({ membership: { id: "m1", role: "owner" } });
    await expect(
      assertClientAccess(db, TEST_USER_ID, ORG_ID, TEST_CLIENT_ID),
    ).resolves.toBeUndefined();
  });

  it("slipper et begrænset medlem igennem på en tildelt klient", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      restrictClientAccess: true,
      grantedClientIds: [TEST_CLIENT_ID],
    });
    await expect(
      assertClientAccess(db, TEST_USER_ID, ORG_ID, TEST_CLIENT_ID),
    ).resolves.toBeUndefined();
  });

  it("afviser et begrænset medlem på en klient det ikke har fået tildelt", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      restrictClientAccess: true,
      grantedClientIds: [TEST_CLIENT_ID],
    });
    await expect(
      assertClientAccess(db, TEST_USER_ID, ORG_ID, TEST_CLIENT_ID_2),
    ).rejects.toThrow(TRPCError);
  });

  it("afviser med FORBIDDEN, ikke NOT_FOUND", async () => {
    const db = makeDb({
      membership: { id: "m1", role: "member" },
      restrictClientAccess: true,
      grantedClientIds: [],
    });
    await expect(
      assertClientAccess(db, TEST_USER_ID, ORG_ID, TEST_CLIENT_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("afviser en bruger der slet ikke er medlem af orgen", async () => {
    const db = makeDb({ membership: undefined });
    await expect(
      assertClientAccess(db, TEST_USER_ID, ORG_ID, TEST_CLIENT_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
