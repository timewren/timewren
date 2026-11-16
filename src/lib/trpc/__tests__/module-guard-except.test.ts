import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { guardedRouter } from "../module-guard";
import type { ModulesContext } from "../routers/enterprise/middleware";

// Ingen moduler slået til: alt, der er vagtet, skal afvises.
const noModules: ModulesContext = {
  raw: new Map(),
  isAvailable: () => false,
  isEnabled: () => false,
};

const t = initTRPC.create();
const authed = t.procedure.use(({ next }) =>
  next({ ctx: { modules: noModules } }),
);

describe("guardedRouter med except", () => {
  it("vagter alt andet, men lader de undtagne procedurer være", async () => {
    const inner = t.router({
      gated: authed.query(() => "gated"),
      ownExport: authed.mutation(() => "eksport"),
    });
    const caller = guardedRouter("reports", inner, {
      except: ["ownExport"],
    }).createCaller({});

    await expect(caller.gated()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.ownExport()).resolves.toBe("eksport");
  });
});
