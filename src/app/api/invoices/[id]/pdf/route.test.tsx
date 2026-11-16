import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireInvoiceRouteAccess: vi.fn(),
  buildInvoicePdfProps: vi.fn(),
  renderInvoicePdfBuffer: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  requireInvoiceRouteAccess: mocks.requireInvoiceRouteAccess,
}));
vi.mock("@/lib/invoice-pdf", () => ({
  buildInvoicePdfProps: mocks.buildInvoicePdfProps,
  renderInvoicePdfBuffer: mocks.renderInvoicePdfBuffer,
}));

const { GET } = await import("./route");

function call() {
  return GET(new NextRequest("http://localhost/api/invoices/inv-1/pdf"), {
    params: Promise.resolve({ id: "inv-1" }),
  });
}

describe("GET /api/invoices/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildInvoicePdfProps.mockResolvedValue({
      invoice: { invoiceNumber: "2026-001" },
      pdfProps: {},
    });
    mocks.renderInvoicePdfBuffer.mockResolvedValue(Buffer.from("pdf"));
  });

  it("svarer 401 uden session og bygger ingen PDF", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(mocks.buildInvoicePdfProps).not.toHaveBeenCalled();
  });

  it("svarer 403, når vagten afviser, og bygger ingen PDF", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "core.roleNoAccess",
    });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.buildInvoicePdfProps).not.toHaveBeenCalled();
  });

  it("kræver læseadgang og bruger vagtens bruger og organisation", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: true,
      userId: "user-1",
      orgId: "org-1",
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.requireInvoiceRouteAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "invoices",
        featureModule: "invoicing",
        required: "read",
      }),
    );
    expect(mocks.buildInvoicePdfProps).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      userId: "user-1",
      orgId: "org-1",
    });
  });
});
