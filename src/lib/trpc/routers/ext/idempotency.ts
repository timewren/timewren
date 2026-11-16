import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { deviceIdempotencyKeys } from "@/lib/db/schema";
import { toUtcSql } from "@/lib/time/db-timestamp";
import type { DeviceAuth } from "./device-procedure";

/**
 * Idempotensnøgle på token-API'ets create-procedurer (desktop 0.2.23).
 *
 * Samme nøgle fra samme bruger og org til samme procedure inden for 24 timer
 * giver det oprindelige objekt (hentet frisk med web's get) i stedet for en
 * dublet. Nøglen gøres krav på atomisk (INSERT … ON CONFLICT), før web's
 * create kaldes, så to samtidige kald aldrig begge opretter. Fejler
 * oprettelsen, frigives nøglen igen, så næste forsøg kan lykkes.
 */

/** Valgfrit felt på create-input. Desktop sender en uuid. */
export const idempotencyKeyInput = z.string().min(8).max(64).optional();

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Et krav uden resultat ældre end dette regnes for forladt (processen døde
 * mellem oprettelse og registrering) og kan tages igen.
 */
export const IDEMPOTENCY_PENDING_MS = 2 * 60 * 1000;

type Db = typeof dbType;

export async function withIdempotencyKey<T>(
  database: Db,
  device: DeviceAuth,
  scope: string,
  key: string | undefined,
  run: {
    create: () => Promise<T>;
    idOf: (created: T) => string;
    replay: (id: string) => Promise<T>;
  },
): Promise<T> {
  if (!key) return run.create();

  const orgKey = device.orgId ?? "";
  const now = new Date();
  const staleBefore = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
  const pendingBefore = new Date(now.getTime() - IDEMPOTENCY_PENDING_MS);

  // Krav på nøglen: en ny række, eller en udløbet/forladt række der tages
  // igen. Ellers findes en gyldig række, og intet returneres.
  const [claimed] = await database
    .insert(deviceIdempotencyKeys)
    .values({ userId: device.userId, orgKey, scope, key, createdAt: now })
    .onConflictDoUpdate({
      target: [
        deviceIdempotencyKeys.userId,
        deviceIdempotencyKeys.orgKey,
        deviceIdempotencyKeys.scope,
        deviceIdempotencyKeys.key,
      ],
      set: { createdAt: now, resultId: null },
      setWhere: sql`${deviceIdempotencyKeys.createdAt} < ${toUtcSql(staleBefore)}::timestamp OR (${deviceIdempotencyKeys.resultId} IS NULL AND ${deviceIdempotencyKeys.createdAt} < ${toUtcSql(pendingBefore)}::timestamp)`,
    })
    .returning({ id: deviceIdempotencyKeys.id });

  if (!claimed) {
    const existing = await database.query.deviceIdempotencyKeys.findFirst({
      where: and(
        eq(deviceIdempotencyKeys.userId, device.userId),
        eq(deviceIdempotencyKeys.orgKey, orgKey),
        eq(deviceIdempotencyKeys.scope, scope),
        eq(deviceIdempotencyKeys.key, key),
      ),
      columns: { resultId: true },
    });
    if (existing?.resultId) return run.replay(existing.resultId);
    throw new TRPCError({
      code: "CONFLICT",
      message: await tr("serverErrors", "ext.createInProgress"),
    });
  }

  let created: T;
  try {
    created = await run.create();
  } catch (err) {
    await database
      .delete(deviceIdempotencyKeys)
      .where(
        and(
          eq(deviceIdempotencyKeys.id, claimed.id),
          isNull(deviceIdempotencyKeys.resultId),
        ),
      );
    throw err;
  }
  await database
    .update(deviceIdempotencyKeys)
    .set({ resultId: run.idOf(created) })
    .where(eq(deviceIdempotencyKeys.id, claimed.id));
  return created;
}
