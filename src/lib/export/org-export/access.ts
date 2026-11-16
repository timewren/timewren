/**
 * Adgangsregler for ZIP-eksporterne. Der er to slags:
 *
 * - Organisations-eksporten (`org_full`): samme regel ved bestilling (tRPC,
 *   orgAdminProcedure) og ved download (her): kun ejer eller administrator af
 *   netop den organisation, eksporten blev lavet for, og kun den bruger, der
 *   bestilte den.
 * - Bruger-eksporten (`user_full`, GDPR art. 15 og 20): alle roller må
 *   bestille deres EGNE data. Ved download kræves, at man er bestilleren og
 *   stadig medlem (uanset rolle) af den organisation, eksporten blev lavet i.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { tr } from "@/i18n/server-text";
import type * as schema from "@/lib/db/schema";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";

export const ORG_EXPORT_REQUEST_TYPE = "org_full";
export const USER_EXPORT_REQUEST_TYPE = "user_full";
/**
 * Alle request_type-værdier, der bygges som ZIP af baggrundsjobbet og
 * hentes fra objektlageret. ALLE andre værdier (`gdpr_full`, `selective`) er
 * den gamle JSON/CSV-eksport, som cron-ruten og download-ruten behandler
 * særskilt. Brug aldrig `ne(requestType, ORG_EXPORT_REQUEST_TYPE)` til at
 * finde de gamle: så ville en bruger-eksport falde ned i den gamle gren.
 */
export const ZIP_EXPORT_TYPES = [
  ORG_EXPORT_REQUEST_TYPE,
  USER_EXPORT_REQUEST_TYPE,
] as const;
export type ZipExportType = (typeof ZIP_EXPORT_TYPES)[number];
export const ORG_EXPORT_FORMAT = "zip";
/** Hvor længe linket og ZIP-filen lever. */
export const ORG_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Højst så mange bestillinger pr. organisation (eller solo-bruger) pr. døgn. */
export const ORG_EXPORT_DAILY_LIMIT = 3;
/** Statusser, hvor ZIP'en kan hentes (flere gange, indtil den udløber). */
export const ORG_EXPORT_DOWNLOADABLE = ["ready", "downloaded"] as const;

export type DownloadDecision =
  | { ok: true }
  | { ok: false; status: 403; reason: string };

export async function authorizeOrgExportDownload(
  db: PostgresJsDatabase<typeof schema>,
  sessionUserId: string,
  request: { userId: string; organizationId: string | null },
): Promise<DownloadDecision> {
  if (request.userId !== sessionUserId) {
    return {
      ok: false,
      status: 403,
      reason: await tr("serverExports", "readme.accessNotYours"),
    };
  }
  if (request.organizationId) {
    const role = await getOrgRole(db, sessionUserId, request.organizationId);
    if (role !== "owner" && role !== "admin") {
      return {
        ok: false,
        status: 403,
        reason: await tr("serverExports", "readme.accessOwnersAdminsOnly"),
      };
    }
  }
  return { ok: true };
}

/**
 * Bruger-eksporten må kun hentes af bestilleren selv, og kun så længe vedkommende
 * stadig er medlem (uanset rolle) af organisationen. Ejeren af organisationen
 * og alle andre får 403: det er den enkeltes egne data.
 */
export async function authorizeUserExportDownload(
  db: PostgresJsDatabase<typeof schema>,
  sessionUserId: string,
  request: { userId: string; organizationId: string | null },
): Promise<DownloadDecision> {
  if (request.userId !== sessionUserId) {
    return {
      ok: false,
      status: 403,
      reason: await tr("serverExports", "readme.accessNotYours"),
    };
  }
  if (request.organizationId) {
    const role = await getOrgRole(db, sessionUserId, request.organizationId);
    if (!role) {
      return {
        ok: false,
        status: 403,
        reason: await tr("serverExports", "readme.accessNotMember"),
      };
    }
  }
  return { ok: true };
}

/** Vælger reglen ud fra eksportens type. Ukendte typer afvises. */
export async function authorizeZipExportDownload(
  db: PostgresJsDatabase<typeof schema>,
  sessionUserId: string,
  request: {
    requestType: string;
    userId: string;
    organizationId: string | null;
  },
): Promise<DownloadDecision> {
  if (request.requestType === USER_EXPORT_REQUEST_TYPE) {
    return authorizeUserExportDownload(db, sessionUserId, request);
  }
  if (request.requestType === ORG_EXPORT_REQUEST_TYPE) {
    return authorizeOrgExportDownload(db, sessionUserId, request);
  }
  return {
    ok: false,
    status: 403,
    reason: await tr("serverExports", "readme.accessUnknownType"),
  };
}
