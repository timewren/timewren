import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * En bruger uden aktiv organisation (typisk et fjernet medlem) må ikke kunne
 * læse organisationsdata via tRPC (web, mobil, REST v1 og MCP går alle
 * gennem isAuthed). Før rettelsen faldt routerne tilbage til `userId` og
 * returnerede de rækker, brugeren selv havde oprettet i den gamle
 * organisation.
 */

const activeOrg = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => activeOrg.value),
  resolveRequestedOrgId: vi.fn(async () => null),
}));
vi.mock("../routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({})),
  makePermissiveModules: vi.fn(() => ({})),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { protectedProcedure, router } from "../trpc";

// Routerne efterligner de rigtige stier, så allowlisten testes på path.
const testRouter = router({
  clients: router({
    list: protectedProcedure.query(({ ctx }) => ({ orgId: ctx.orgId })),
  }),
  user: router({
    getProfile: protectedProcedure.query(() => "profil"),
    deleteAccount: protectedProcedure.mutation(() => "slettet"),
  }),
});

function caller() {
  return testRouter.createCaller({
    session: { user: { id: "fjernet-medlem" } } as never,
    db: {} as never,
    headers: null,
  });
}

describe("bruger uden aktiv organisation", () => {
  beforeEach(() => {
    activeOrg.value = null;
  });

  it("afvises på organisationsdata (clients.list)", async () => {
    await expect(caller().clients.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("kan stadig læse egen profil og slette sin konto", async () => {
    await expect(caller().user.getProfile()).resolves.toBe("profil");
    await expect(caller().user.deleteAccount()).resolves.toBe("slettet");
  });

  it("påvirker ikke et aktivt medlem", async () => {
    activeOrg.value = "org-a";
    await expect(caller().clients.list()).resolves.toEqual({
      orgId: "org-a",
    });
  });
});
