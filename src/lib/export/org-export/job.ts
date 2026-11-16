/**
 * Baggrundsjobbet for ZIP-eksporter, både hele organisationen (`org_full`) og
 * den enkelte brugers egne data (`user_full`). Kaldes fra
 * /api/cron/data-export hvert 2. minut:
 * 1. udløbne eksporter slettes fra objektlageret og markeres udløbet,
 * 2. eksporter, der er gået i stå, markeres fejlet,
 * 3. højst én ventende eksport tages atomisk og bygges.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import { getAppUrl } from "@/lib/config";
import type { db as dbType } from "@/lib/db";
import { dataExportRequests, users } from "@/lib/db/schema";
import { sendDataExportReady } from "@/lib/email/data-export";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { revealToken } from "@/lib/security/token-hash";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";
import { captureRouteError } from "@/lib/utils/sentry";
import {
  ORG_EXPORT_DOWNLOADABLE,
  USER_EXPORT_REQUEST_TYPE,
  ZIP_EXPORT_TYPES,
} from "./access";
import {
  deleteOrgExport,
  isExportStorageConfigured,
  putOrgExportStream,
} from "./storage";
import { generateOrgExportZip, generateUserExportZip } from "./zip";

const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;

export interface OrgExportJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function processOrgExports(
  db: typeof dbType,
): Promise<OrgExportJobResult> {
  const result: OrgExportJobResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  const now = new Date();

  // 1. Udløbne: slet ZIP'en og markér udløbet
  const expired = await db
    .select({ id: dataExportRequests.id })
    .from(dataExportRequests)
    .where(
      and(
        inArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
        inArray(dataExportRequests.status, [...ORG_EXPORT_DOWNLOADABLE]),
        lte(dataExportRequests.expiresAt, now),
      ),
    );
  for (const { id } of expired) {
    try {
      if (isExportStorageConfigured()) await deleteOrgExport(id);
      await db
        .update(dataExportRequests)
        .set({ status: "expired" })
        .where(eq(dataExportRequests.id, id));
    } catch (err) {
      result.errors.push(
        `Sletning af eksport ${id}: ${(err as Error).message}`,
      );
    }
  }

  // 2. Gået i stå (fx genstart midt i en kørsel)
  await db
    .update(dataExportRequests)
    .set({
      status: "failed",
      errorMessage: await tr("serverExports", "readme.jobStalled"),
    })
    .where(
      and(
        inArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
        eq(dataExportRequests.status, "processing"),
        lte(
          dataExportRequests.createdAt,
          new Date(now.getTime() - STUCK_AFTER_MS),
        ),
      ),
    );

  // 3. Tag én ventende eksport atomisk, så overlappende kørsler ikke bygger
  // den samme to gange.
  const claimed = (await db.execute(sql`
    update ${dataExportRequests}
    set status = 'processing'
    where id = (
      select id from ${dataExportRequests}
      where status = 'pending'
        and request_type in (${sql.join(
          ZIP_EXPORT_TYPES.map((type) => sql`${type}`),
          sql`, `,
        )})
      order by created_at
      limit 1
      for update skip locked
    )
    returning id
  `)) as unknown as { id: string }[];
  const claimedId = claimed[0]?.id;
  if (!claimedId) return finish(result);

  result.processed++;
  const request = await db.query.dataExportRequests.findFirst({
    where: eq(dataExportRequests.id, claimedId),
  });
  if (!request) return finish(result);

  const isUserExport = request.requestType === USER_EXPORT_REQUEST_TYPE;
  // README, filoversigt og fejltekster på bestillerens sprog.
  const locale = await getRecipientLocale({ userId: request.userId });
  try {
    // Rollen tjekkes igen. Organisations-eksporten kræver stadig ejer eller
    // administrator (en administrator kan være sat ned siden bestillingen).
    // Bruger-eksporten kræver bare, at man stadig er medlem, uanset rolle.
    if (request.organizationId) {
      const role = await getOrgRole(db, request.userId, request.organizationId);
      if (isUserExport) {
        if (!role) {
          throw new Error(
            await tr(
              "serverExports",
              "readme.notMemberAnymore",
              undefined,
              locale,
            ),
          );
        }
      } else if (role !== "owner" && role !== "admin") {
        throw new Error(
          await tr(
            "serverExports",
            "readme.notOwnerAnymore",
            undefined,
            locale,
          ),
        );
      }
    }

    // ZIP'en streames til objektlageret og samles aldrig i hukommelsen. Uden
    // lager er der intet sted at gemme den, og download-ruten bygger ikke en
    // ny, så det er en fejl nu frem for et dødt link senere.
    if (!isExportStorageConfigured()) {
      throw new Error(
        await tr("serverExports", "readme.storageMissing", undefined, locale),
      );
    }
    const scope = { orgId: request.organizationId, userId: request.userId };
    let byteLength = 0;
    await putOrgExportStream(request.id, async (out) => {
      const written = isUserExport
        ? await generateUserExportZip(db, scope, out, undefined, locale)
        : await generateOrgExportZip(db, scope, out, undefined, locale);
      byteLength = written.byteLength;
    });

    await db
      .update(dataExportRequests)
      .set({
        status: "ready",
        processedAt: new Date(),
        fileSizeBytes: byteLength,
      })
      .where(eq(dataExportRequests.id, request.id));
    result.succeeded++;

    const user = await db.query.users.findFirst({
      where: eq(users.id, request.userId),
      columns: { name: true, email: true },
    });
    const downloadToken = revealToken(request.downloadTokenEncrypted);
    if (user && downloadToken) {
      const appUrl = getAppUrl();
      try {
        await sendDataExportReady({
          to: user.email,
          recipientName: user.name,
          downloadUrl: `${appUrl}/api/data-export/${downloadToken}`,
          expiresAt: request.expiresAt.toISOString(),
          format: request.format,
          userId: request.userId,
          scope: isUserExport ? "user" : "organization",
        });
      } catch (emailErr) {
        console.error(
          `Mail om ${isUserExport ? "bruger" : "organisations"}-eksport ${request.id} fejlede:`,
          emailErr,
        );
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    await db
      .update(dataExportRequests)
      .set({ status: "failed", errorMessage: message.slice(0, 500) })
      .where(eq(dataExportRequests.id, request.id));
    result.failed++;
    result.errors.push(
      `${isUserExport ? "Bruger" : "Organisations"}-eksport ${request.id}: ${message}`,
    );
  }

  return finish(result);
}

function finish(result: OrgExportJobResult): OrgExportJobResult {
  if (result.errors.length > 0) {
    captureRouteError(new Error(result.errors.join("; ")), {
      route: "/api/cron/data-export",
      type: "cron",
    });
  }
  return result;
}
