import { and, eq } from "drizzle-orm";
import { isMultibrandEnabled } from "@/lib/brands/registry";
import { getAppUrl } from "@/lib/config";
import type { db as DbClient } from "@/lib/db";
import { clientPortalAccess, clients, users } from "@/lib/db/schema";
import { recipientMailBrand } from "@/lib/email/mail-brand";
import { readPortalAccessToken } from "@/lib/portal/access-token";

// Portal-distribution (#95): kunde-vendte mails skal linke til portalen —
// kunden opdager den ellers aldrig. Returnerer null når kunden ingen aktiv
// adgang har (mailen viser så ikke portal-knappen).
export async function getClientPortalUrl(
  db: typeof DbClient,
  clientId: string,
): Promise<string | null> {
  const access = await db.query.clientPortalAccess.findFirst({
    where: and(
      eq(clientPortalAccess.clientId, clientId),
      eq(clientPortalAccess.isActive, true),
    ),
    columns: {
      accessType: true,
      accessTokenEncrypted: true,
      tokenExpiresAt: true,
    },
  });
  if (!access) return null;

  const baseUrl = await portalBaseUrl(db, clientId);
  const accessToken = readPortalAccessToken(access);
  if (access.accessType === "token" && accessToken) {
    if (access.tokenExpiresAt && access.tokenExpiresAt < new Date()) {
      return null;
    }
    return `${baseUrl}/portal/t/${accessToken}`;
  }
  return `${baseUrl}/portal/login`;
}

/**
 * Multibrand: portalen ligger på kundeejerens brand-host (fx timewren.com).
 * Uden MULTIBRAND_ENABLED=1 og for timetrack-konti: appens URL som før.
 */
async function portalBaseUrl(
  db: typeof DbClient,
  clientId: string,
): Promise<string> {
  if (!isMultibrandEnabled()) return getAppUrl();
  const [row] = await db
    .select({ brand: users.brand })
    .from(clients)
    .innerJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, clientId))
    .limit(1);
  return recipientMailBrand(row?.brand)?.appUrl ?? getAppUrl();
}
