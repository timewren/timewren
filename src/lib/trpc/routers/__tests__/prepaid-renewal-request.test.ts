import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/prepaid/renew-package", () => ({ renewPackageInTx: vi.fn() }));
vi.mock("../clientAccess", () => ({
  assertClientAccess: vi.fn(),
  getAccessibleClientIds: vi.fn(),
}));

import { renewPackageInTx } from "@/lib/prepaid/renew-package";
import { assertClientAccess } from "../clientAccess";
import { prepaidRouter } from "../prepaid";

beforeEach(() => vi.resetAllMocks());

// Exercise the mutation body; shared tRPC authentication/module middleware has
// its own tests. The renewal transaction is mocked so no invoice or mail leaves
// the test process.
function resolve(approve: boolean, active = true) {
  const where = vi.fn().mockResolvedValue(undefined);
  const db = {
    query: {
      prepaidRenewalRequests: {
        findFirst: vi.fn().mockResolvedValue({
          clientId: "client",
          prepaidPackageId: "package",
        }),
      },
    },
    update: () => ({ set: () => ({ where }) }),
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [{ id: "package", name: "Timer", isActive: active }],
        }),
      }),
    }),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (fn) => fn(db));
  const { resolver } = prepaidRouter.resolveRenewalRequest._def as unknown as {
    resolver: (options: unknown) => Promise<unknown>;
  };
  if (!resolver) throw new Error("Missing mutation resolver");
  return resolver({
    ctx: { db, session: { user: { id: "owner" } }, orgId: "org" },
    input: { requestId: "request", approve },
    type: "mutation",
    path: "prepaid.resolveRenewalRequest",
    signal: undefined,
  } as never);
}

it("returns the invoice id from the committed renewal for immediate sending", async () => {
  vi.mocked(renewPackageInTx).mockResolvedValue({
    newPackageId: "new-package",
    draftInvoiceId: "invoice",
  });
  await expect(resolve(true)).resolves.toEqual({
    approved: true,
    invoiceId: "invoice",
  });
  expect(assertClientAccess).toHaveBeenCalledWith(
    expect.anything(),
    "owner",
    "org",
    "client",
  );
});
it("returns no invoice when the renewal does not create one", async () => {
  vi.mocked(renewPackageInTx).mockResolvedValue({
    newPackageId: "new-package",
    draftInvoiceId: null,
  });
  await expect(resolve(true)).resolves.toEqual({
    approved: true,
    invoiceId: null,
  });
});
it("never renews or returns an invoice for an already renewed package", async () => {
  await expect(resolve(true, false)).resolves.toEqual({
    approved: true,
    invoiceId: null,
  });
  expect(renewPackageInTx).not.toHaveBeenCalled();
});
it("declines without creating an invoice", async () => {
  await expect(resolve(false)).resolves.toEqual({
    approved: false,
    invoiceId: null,
  });
  expect(renewPackageInTx).not.toHaveBeenCalled();
});
it("does not return an invoice when renewal fails", async () => {
  vi.mocked(renewPackageInTx).mockRejectedValue(new Error("Rollback"));
  await expect(resolve(true)).rejects.toThrow("Rollback");
});
