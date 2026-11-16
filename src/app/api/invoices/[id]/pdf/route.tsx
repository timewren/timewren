import { type NextRequest, NextResponse } from "next/server";
import { requireInvoiceRouteAccess } from "@/lib/auth/route-guards";
import {
  buildInvoicePdfProps,
  renderInvoicePdfBuffer,
} from "@/lib/invoice-pdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireInvoiceRouteAccess({
      headers: request.headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "read",
    });
    if (!access.ok) {
      return new NextResponse(access.error, { status: access.status });
    }
    const { userId, orgId } = access;

    const { id } = await params;

    // Load invoice + PDF props via the shared helper (same data as the
    // emailed PDF).
    const pdfData = await buildInvoicePdfProps({
      invoiceId: id,
      userId,
      orgId,
    });

    if (!pdfData) {
      return new NextResponse("Invoice not found", { status: 404 });
    }

    const buffer = await renderInvoicePdfBuffer(pdfData.pdfProps);

    // Return PDF with proper headers
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Faktura_${pdfData.invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
