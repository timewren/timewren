import { and, eq, gte } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clientPortalSessions,
  clients,
  portalActivityLogs,
} from "@/lib/db/schema";
import {
  buildInvoicePdfProps,
  renderInvoicePdfBuffer,
} from "@/lib/invoice-pdf";
import { tokenLookup } from "@/lib/security/token-hash";

// Portal invoice PDF download. Authenticated with the client's portal session
// token (query param — the portal has no cookies) and gated by the
// canDownloadInvoices permission. The invoice is scoped to the portal
// client, so a session can never fetch another client's invoice.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionToken = request.nextUrl.searchParams.get("session");

    if (!sessionToken) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const session = await db.query.clientPortalSessions.findFirst({
      where: and(
        tokenLookup(clientPortalSessions.sessionTokenHash, sessionToken),
        gte(clientPortalSessions.expiresAt, new Date()),
      ),
      with: {
        portalAccess: true,
      },
    });

    const access = session?.portalAccess;
    if (!access?.isActive) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!access.canDownloadInvoices) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Portal data is scoped to the client's org (matching validateAccess in
    // the publicPortal router) so a team's client sees org invoices.
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, access.clientId),
      columns: { organizationId: true },
    });

    const pdfData = await buildInvoicePdfProps({
      invoiceId: id,
      userId: access.freelancerId,
      orgId: client?.organizationId ?? null,
      clientId: access.clientId,
    });

    if (!pdfData) {
      return new NextResponse("Invoice not found", { status: 404 });
    }

    const buffer = await renderInvoicePdfBuffer(pdfData.pdfProps);

    // Log activity (same pattern as the publicPortal queries)
    try {
      await db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "download_invoice",
        entityType: "invoice",
        entityId: id,
        entityName: pdfData.invoice.invoiceNumber,
      });
    } catch (logErr) {
      console.error("[Portal PDF] Failed to log activity:", logErr);
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Faktura_${pdfData.invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Portal PDF] generation error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
