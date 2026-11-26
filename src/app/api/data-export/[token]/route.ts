import { and, eq, gt, inArray, notInArray } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { sharedT } from "@/i18n/shared-text";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dataExportRequests } from "@/lib/db/schema";
import { runWithDemoCurrency } from "@/lib/demo/server-currency";
import {
  authorizeZipExportDownload,
  ORG_EXPORT_DOWNLOADABLE,
  USER_EXPORT_REQUEST_TYPE,
  ZIP_EXPORT_TYPES,
} from "@/lib/export/org-export/access";
import {
  getOrgExportStream,
  isExportStorageConfigured,
} from "@/lib/export/org-export/storage";
import { tokenLookup } from "@/lib/security/token-hash";
import { copenhagenToday } from "@/lib/time/copenhagen";
import {
  CLIENT_COLUMNS,
  type CSVColumn,
  convertToCSV,
  INVOICE_COLUMNS,
  INVOICE_LINE_COLUMNS,
  PREPAID_COLUMNS,
  PREPAID_USAGE_COLUMNS,
  PROJECT_COLUMNS,
  RATE_HISTORY_COLUMNS,
  TASK_COLUMNS,
  TIME_ENTRY_COLUMNS,
} from "@/lib/utils/csv-export";
import { generateUserDataExport } from "@/lib/utils/data-export";

/**
 * GET /api/data-export/[token]
 * Download a data export by token — requires authentication
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    // Verify session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ZIP-eksport: fra objektlageret. Organisations-eksporten kan kun hentes
    // af ejer/administrator af netop den organisation, bruger-eksporten kun af
    // den bruger, der bestilte den (og kun som medlem). Begge kun af
    // bestilleren selv.
    const zipRequest = await db.query.dataExportRequests.findFirst({
      where: and(
        tokenLookup(dataExportRequests.downloadTokenHash, token),
        inArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
        inArray(dataExportRequests.status, [...ORG_EXPORT_DOWNLOADABLE]),
        gt(dataExportRequests.expiresAt, new Date()),
      ),
    });
    if (zipRequest) {
      return downloadZipExport(zipRequest, session.user.id);
    }

    // Look up request by token (den gamle JSON/CSV-eksport)
    const exportRequest = await db.query.dataExportRequests.findFirst({
      where: and(
        tokenLookup(dataExportRequests.downloadTokenHash, token),
        notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
        eq(dataExportRequests.status, "ready"),
        gt(dataExportRequests.expiresAt, new Date()),
      ),
    });

    if (!exportRequest) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.dataExport.notFoundOrExpired") },
        { status: 404 },
      );
    }

    // Verify the authenticated user owns this export
    if (exportRequest.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate the export data on-the-fly
    const exportData = await generateUserDataExport(db, exportRequest.userId);

    // Mark as downloaded
    await db
      .update(dataExportRequests)
      .set({
        status: "downloaded",
        downloadedAt: new Date(),
      })
      .where(eq(dataExportRequests.id, exportRequest.id));

    if (exportRequest.format === "json") {
      // Stream as JSON file
      const jsonContent = JSON.stringify(exportData, null, 2);
      const filename = `timetrack-data-export-${copenhagenToday()}.json`;

      return new NextResponse(jsonContent, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // CSV format — generate a combined CSV with section headers
    const sections: string[] = [];
    const BOM = "\uFEFF";

    const addSection = (
      title: string,
      data: Record<string, unknown>[],
      columns: CSVColumn[],
    ) => {
      if (data.length > 0) {
        sections.push(`\n=== ${title} ===`);
        sections.push(
          runWithDemoCurrency(session.user.email, () =>
            convertToCSV(data, columns, {
              delimiter: ";",
              dateFormat: "danish",
              decimalSeparator: ",",
            }),
          ),
        );
      }
    };

    addSection(
      sharedT("sharedExport", "sections.kunder"),
      exportData.clients,
      CLIENT_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.projekter"),
      exportData.projects,
      PROJECT_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.tidsregistreringer"),
      exportData.timeEntries,
      TIME_ENTRY_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.opgaver"),
      exportData.tasks,
      TASK_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.fakturaer"),
      exportData.invoices,
      INVOICE_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.fakturaliner"),
      exportData.invoiceLines,
      INVOICE_LINE_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.klippekort"),
      exportData.prepaidPackages,
      PREPAID_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.klippekortForbrug"),
      exportData.prepaidUsage,
      PREPAID_USAGE_COLUMNS,
    );
    addSection(
      sharedT("sharedExport", "sections.prishistorik"),
      exportData.rateHistory,
      RATE_HISTORY_COLUMNS,
    );

    const csvContent = BOM + sections.join("\n");
    const filename = `timetrack-data-export-${copenhagenToday()}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Data export download error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function downloadZipExport(
  request: typeof dataExportRequests.$inferSelect,
  sessionUserId: string,
) {
  const decision = await authorizeZipExportDownload(db, sessionUserId, {
    requestType: request.requestType,
    userId: request.userId,
    organizationId: request.organizationId,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  // ZIP'en bygges kun af baggrundsjobbet og streames til objektlageret. Mangler
  // objektet, bygges den ikke om i brugerens request (det ville holde hele
  // arkivet i webprocessens hukommelse); brugeren bestiller en ny. Intet
  // markeres som hentet, før der er noget at hente.
  const stored = isExportStorageConfigured()
    ? await getOrgExportStream(request.id)
    : null;
  if (!stored) {
    return NextResponse.json(
      {
        error: await tr("serverErrors", "api.dataExport.expired"),
      },
      { status: 410 },
    );
  }

  await db
    .update(dataExportRequests)
    .set({ status: "downloaded", downloadedAt: new Date() })
    .where(eq(dataExportRequests.id, request.id));

  const isUserExport = request.requestType === USER_EXPORT_REQUEST_TYPE;
  const filename = `timetrack-${isUserExport ? "mine-data" : "organisation-eksport"}-${copenhagenToday()}.zip`;
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };

  if (stored.size) headers["Content-Length"] = String(stored.size);
  return new NextResponse(stored.stream, { headers });
}
