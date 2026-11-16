import { TRPCError } from "@trpc/server";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildInvoicePdfProps,
  renderInvoicePdfBuffer,
} from "@/lib/invoice-pdf";
import { authenticateDeviceToken } from "@/lib/trpc/routers/ext/device-procedure";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

/** 401, eller 429 når IP'en har brugt sit budget for forkerte tokens. */
async function unauthorized(request: NextRequest) {
  const limit = await rateLimiter.check(
    ipRateLimitKey(getClientIp(request.headers), "ext.invoicePdf"),
    "extensionToken",
  );
  return new NextResponse(
    limit.allowed ? "Unauthorized" : "Too Many Requests",
    {
      status: limit.allowed ? 401 : 429,
    },
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ext/invoices/<id>/pdf — fakturaens PDF til token-klienter
 * (desktop 1.0). Samme PDF og samme org-afgrænsning som web's
 * /api/invoices/<id>/pdf, men med `Authorization: Bearer <extension-token>`
 * og `?organizationId=` i stedet for sessionscookien.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized(request);

  let orgId: string | null;
  let userId: string;
  try {
    const auth = await authenticateDeviceToken(
      db,
      token,
      request.nextUrl.searchParams.get("organizationId") || null,
    );
    orgId = auth.orgId;
    userId = auth.userId;
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      return new NextResponse("Forbidden", { status: 403 });
    }
    // Mislykkede forsøg tæller mod IP'ens budget (som /api/ext/stream).
    if (err instanceof TRPCError) return unauthorized(request);
    throw err;
  }

  try {
    const { id } = await params;
    const pdfData = await buildInvoicePdfProps({
      invoiceId: id,
      userId,
      orgId,
    });
    if (!pdfData) {
      return new NextResponse("Invoice not found", { status: 404 });
    }
    const buffer = await renderInvoicePdfBuffer(pdfData.pdfProps);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Faktura_${pdfData.invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[ext invoice pdf] error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
