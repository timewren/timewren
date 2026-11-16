import { createHash } from "node:crypto";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { blockedByTwoFactor, type DpaViewer, resolveDpaViewer } from "./filled";
import { DPA_SHA256_SHORT, DPA_VERSION } from "./meta";
import { renderDpaPdf } from "./pdf";

type Db = typeof dbType;

/**
 * Den generelle PDF er ens for alle og ændrer sig kun med aftaleteksten, så
 * den renderes én gang pr. proces og version. Nøglen er tekstens hash.
 */
let generalCache: { key: string; pdf: Promise<Buffer> } | null = null;

export function generalDpaPdf(): Promise<Buffer> {
  const key = `${DPA_VERSION}:${DPA_SHA256_SHORT}`;
  if (!generalCache || generalCache.key !== key) {
    const pdf = renderDpaPdf(null);
    // Fejler renderen, må næste forespørgsel prøve igen.
    pdf.catch(() => {
      if (generalCache?.pdf === pdf) generalCache = null;
    });
    generalCache = { key, pdf };
  }
  return generalCache.pdf;
}

/**
 * ETag ud fra selve PDF-bytes, så også en ændring i layoutet (ikke kun i
 * teksten) giver en ny ETag.
 */
let etagCache: { pdf: Buffer; etag: string } | null = null;
export async function generalDpaEtag(): Promise<string> {
  const pdf = await generalDpaPdf();
  if (etagCache?.pdf !== pdf) {
    const hash = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
    etagCache = { pdf, etag: `"dpa-${DPA_VERSION}-${hash}"` };
  }
  return etagCache.etag;
}

export type FilledAccess =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Regel for den udfyldte PDF: kun ejer eller administrator af den aktive
 * organisation (og med 2FA, hvis organisationen kræver det). Alle andre får
 * den generelle PDF via /api/dpa/pdf.
 */
export async function decideFilledAccess(
  db: Db,
  viewer: DpaViewer,
): Promise<FilledAccess> {
  switch (viewer.kind) {
    case "anonymous":
      return {
        ok: false,
        status: 401,
        reason: await tr("serverErrors", "enterprise.dpa.signIn"),
      };
    case "no-org":
      return {
        ok: false,
        status: 403,
        reason: await tr("serverErrors", "dpa.notInOrg"),
      };
    case "member":
      return {
        ok: false,
        status: 403,
        reason: await tr("serverErrors", "enterprise.dpa.ownersAdminsDownload"),
      };
    case "admin":
      if (await blockedByTwoFactor(db, viewer.orgId, viewer.userId)) {
        return {
          ok: false,
          status: 403,
          reason: await tr("serverErrors", "enterprise.mw.twoFactorAdmins"),
        };
      }
      return { ok: true, orgId: viewer.orgId, userId: viewer.userId };
  }
}

export async function filledAccessForSession(
  db: Db,
  session: Record<string, unknown> | null | undefined,
): Promise<FilledAccess> {
  return decideFilledAccess(db, await resolveDpaViewer(db, session));
}

export function pdfHeaders(
  filename: string,
  cacheControl: string,
): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };
}
