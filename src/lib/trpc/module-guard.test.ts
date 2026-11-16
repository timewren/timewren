import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_BUNDLE } from "@/lib/modules/constants";
import { guardedRouter } from "./module-guard";
import type { ModulesContext } from "./routers/enterprise/middleware";

function makeModules(
  overrides: Record<string, { available: boolean; enabled: boolean }>,
): ModulesContext {
  const raw = new Map(Object.entries(overrides)) as ModulesContext["raw"];
  return {
    raw,
    isAvailable: (key) => raw.get(key)?.available ?? false,
    isEnabled: (key) => {
      const s = raw.get(key);
      return Boolean(s?.available && s?.enabled);
    },
  };
}

interface TestCtx {
  modules: ModulesContext;
}

const t = initTRPC.context<TestCtx>().create({ transformer: superjson });

// Factory — each test gets a fresh router so guardedRouter mutations don't
// bleed across tests (guardedRouter mutates _def.middlewares in-place).
function makeInnerRouter() {
  return t.router({
    ping: t.procedure.query(() => "pong"),
    echo: t.procedure
      .input((v: unknown) => v as string)
      .mutation(({ input }) => `echo:${input}`),
  });
}

describe("guardedRouter", () => {
  it("allows calls when module is enabled", async () => {
    const guarded = guardedRouter("invoicing", makeInnerRouter());
    const caller = t.createCallerFactory(guarded)({
      modules: makeModules({ invoicing: { available: true, enabled: true } }),
    });
    expect(await caller.ping()).toBe("pong");
    expect(await caller.echo("hi")).toBe("echo:hi");
  });

  it("blocks calls when module is disabled", async () => {
    const guarded = guardedRouter("invoicing", makeInnerRouter());
    const caller = t.createCallerFactory(guarded)({
      modules: makeModules({ invoicing: { available: true, enabled: false } }),
    });
    await expect(caller.ping()).rejects.toThrow(TRPCError);
    await expect(caller.ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks calls when module is unavailable", async () => {
    const guarded = guardedRouter("invoicing", makeInnerRouter());
    const caller = t.createCallerFactory(guarded)({
      modules: makeModules({ invoicing: { available: false, enabled: false } }),
    });
    await expect(caller.echo("x")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("includes the module key in the error message", async () => {
    const guarded = guardedRouter("klippekort", makeInnerRouter());
    const caller = t.createCallerFactory(guarded)({
      modules: makeModules({
        klippekort: { available: false, enabled: false },
      }),
    });
    await expect(caller.ping()).rejects.toThrow(/klippekort/);
  });
});

describe("guardedRouter — freelance-moduler i enterprise-bundle (#483)", () => {
  // Enterprise-orgs har kun ENTERPRISE_BUNDLE tændt. Freelance-routere
  // (clients/prepaid/invoices) skal svare FORBIDDEN — ikke tom liste — så
  // klienten gate'r kaldet med `enabled: isEnabled(<modul>)` frem for at
  // forvente et tomt svar.
  const enterpriseModules = () =>
    makeModules(
      Object.fromEntries(
        ENTERPRISE_BUNDLE.map((key) => [
          key,
          { available: true, enabled: true },
        ]),
      ),
    );

  it.each(["clients", "klippekort", "invoicing"] as const)(
    "blokerer %s-routeren med FORBIDDEN for en enterprise-org",
    async (moduleKey) => {
      const guarded = guardedRouter(moduleKey, makeInnerRouter());
      const caller = t.createCallerFactory(guarded)({
        modules: enterpriseModules(),
      });
      await expect(caller.ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it.each(["projects", "tasks", "reports"] as const)(
    "tillader %s-routeren for en enterprise-org (del af ENTERPRISE_BUNDLE)",
    async (moduleKey) => {
      const guarded = guardedRouter(moduleKey, makeInnerRouter());
      const caller = t.createCallerFactory(guarded)({
        modules: enterpriseModules(),
      });
      expect(await caller.ping()).toBe("pong");
    },
  );
});
