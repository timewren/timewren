// Tilbagekald af Google Calendar-bevillinger hos Google.
//
// Når en bruger frakobler Google Calendar eller sletter sin konto, er det ikke
// nok at slette rækkerne: appen ville stadig stå under
// myaccount.google.com/connections. Derfor kaldes Googles revoke-endpoint med
// forbindelsens eget refresh-token (det fjerner hele bevillingen), ellers
// access-tokenet.
//
// Et tilbagekald fjerner hele bevillingen for Google-kontoen og Cloud-
// projektet, ikke kun dette token, og kan dermed slå en anden lokal brugers
// eller et andet brands forbindelse til samme Google-konto ihjel. Derfor
// tilbagekaldes der kun, når det beviseligt er sikkert; ellers slettes der
// kun lokalt:
//
// 1. Rækken har intet Google-konto-id (`provider_account_sub`): intet
//    tilbagekald (`no_account_id`).
// 2. Har en anden række (enhver bruger, ethvert brand) samme konto-id: intet
//    tilbagekald (`shared_account`). Rækken selv er den eneste, der ikke
//    tælles med. Rækker uden konto-id tælles ikke: de får deres id ved næste
//    synkronisering, og rammes en sådan række af et tilbagekald, viser den
//    "forbind igen".
// 3. Ellers tilbagekaldes rækkens eget token. 200 = tilbagekaldt, 400
//    `invalid_token` = allerede væk, alt andet logges som fejl. Rækken
//    slettes under alle omstændigheder.
//
// Beslutningen tages i den transaktion, der sletter rækken, under brugerens
// lås, en rækkelås og en lås på Google-kontoen. OAuth-callbacken tager de
// samme låse, før den gemmer, så en gem aldrig blandes med en sletning af
// samme konto. Google kaldes først efter commit, så en rollback (også en, der
// først sker ved COMMIT) aldrig efterlader en lokal forbindelse med en
// tilbagekaldt bevilling. Kaldet sker i en ny transaktion, der igen tager
// kontoens lås og tæller rækkerne med kontoens id: har en callback gemt en
// forbindelse til kontoen mellem commit og kaldet, tilbagekaldes der ikke, og
// en callback, der kommer under kaldet, venter på låsen. Gentilkobles der få
// sekunder efter en frakobling, kan tilbagekaldet (som Google desuden udfører
// med forsinkelse) stadig ramme tokens, Google udstedte før det; næste
// fornyelse giver så `invalid_grant`, og forbindelsen viser "forbind igen".
// https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
//
// Logning og Sentry får kun faste årsager og statuskoder, aldrig tokens eller
// svarets indhold.

import * as Sentry from "@sentry/nextjs";
import { and, eq, ne, sql } from "drizzle-orm";
import type { BrandKey } from "@/lib/brands/registry";
import type { db as defaultDb } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import { decryptSecretOrNull } from "@/lib/utils/encryption";
import { connectionOAuthBrand } from "./calendar-oauth-clients";

type Db = typeof defaultDb;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Pick<Db, "execute">;

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const REVOKE_TIMEOUT_MS = 10_000;

/** De kolonner, der skal til for at afgøre og udføre et tilbagekald. */
export interface GoogleCalendarRevokeRow {
  id: string;
  parentConnectionId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  oauthBrand?: string | null;
  providerAccountSub: string | null;
}

type SkipReason = "no_account_id" | "shared_account" | "no_token";

function logSkipped(userId: string, brand: BrandKey, reason: SkipReason) {
  console.info(
    JSON.stringify({ event: "calendar_revoke_skipped", reason, brand, userId }),
  );
}

function logFailed(
  userId: string,
  brand: BrandKey,
  reason: string,
  status?: number,
) {
  console.error(
    JSON.stringify({
      event: "calendar_revoke_failed",
      reason,
      ...(status !== undefined && { status }),
      brand,
      userId,
    }),
  );
  Sentry.captureException(new Error("Google Calendar revoke failed"), {
    tags: {
      source: "google-calendar-revoke",
      reason,
      brand,
      ...(status !== undefined && { status: String(status) }),
    },
    user: { id: userId },
  });
}

/**
 * Lås brugerens Google Calendar-rækker til transaktionens slutning. Tages
 * først af frakobling, kontosletning, callbacken og udfyldningen af konto-id.
 */
export async function lockGoogleCalendarUser(
  tx: Executor,
  userId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-calendar-user:${userId}`}, 0))`,
  );
}

/**
 * Lås en Google-konto (konto-id) til transaktionens slutning. Tages efter
 * brugerlåsen og, ved flere konti, i sorteret rækkefølge.
 */
export async function lockGoogleCalendarAccount(
  tx: Executor,
  accountSub: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-calendar-account:${accountSub}`}, 0))`,
  );
}

/**
 * Tag brugerens lås og lås brugerens Google Calendar-rækker (`FOR UPDATE`),
 * før de slettes i samme transaktion. Giver rækkerne til
 * `revokeGoogleCalendarGrants`.
 */
export async function lockGoogleCalendarRows(
  tx: Pick<Tx, "execute" | "select">,
  userId: string,
): Promise<GoogleCalendarRevokeRow[]> {
  await lockGoogleCalendarUser(tx, userId);
  return tx
    .select({
      id: calendarConnections.id,
      parentConnectionId: calendarConnections.parentConnectionId,
      accessToken: calendarConnections.accessToken,
      refreshToken: calendarConnections.refreshToken,
      oauthBrand: calendarConnections.oauthBrand,
      providerAccountSub: calendarConnections.providerAccountSub,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, "google"),
      ),
    )
    .for("update");
}

type RevokeResult =
  | { ok: true }
  | { ok: false; reason: "timeout" | "network" | "http"; status?: number };

/** Ét revoke-kald. Læser kun svarets `error`-felt ved 400, logger intet. */
async function revokeToken(token: string): Promise<RevokeResult> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      reason:
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "network",
    };
  }
  if (res.status === 200) return { ok: true };
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (body?.error === "invalid_token") return { ok: true };
  }
  return { ok: false, reason: "http", status: res.status };
}

/** Et besluttet tilbagekald: rækkens eget token, kaldes efter sletningen. */
export interface PlannedGoogleCalendarRevoke {
  userId: string;
  brand: BrandKey;
  accountSub: string;
  token: string;
}

/** Antal Google-rækker med kontoens id (uden LIMIT), evt. uden én række. */
async function countAccountRows(
  executor: Pick<Tx, "select">,
  accountSub: string,
  exceptId?: string,
): Promise<number> {
  const [{ shared }] = await executor
    .select({ shared: sql<number>`count(*)::int` })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.providerAccountSub, accountSub),
        exceptId ? ne(calendarConnections.id, exceptId) : undefined,
      ),
    );
  return shared;
}

/**
 * Afgør, hvilke af rækkerne der må tilbagekaldes hos Google. Kaldes i `tx`,
 * før rækkerne slettes; rækkerne skal være læst med `FOR UPDATE` under
 * `lockGoogleCalendarUser`. Kontolåsene tages i `tx` og holdes til commit.
 *
 * Hver række tælles mod alle andre rækker end sig selv, også brugerens egne,
 * der slettes i samme omgang. Optællingen kører i et savepoint og kaster aldrig; en fejl betyder intet
 * tilbagekald.
 *
 * Google kaldes først med `executeGoogleCalendarRevokes`, når transaktionen
 * er committet, så en rollback aldrig efterlader en lokal forbindelse med en
 * tilbagekaldt bevilling. Dér tælles der igen under kontoens lås.
 */
export async function planGoogleCalendarRevokes(
  tx: Pick<Tx, "execute" | "transaction">,
  userId: string,
  rows: GoogleCalendarRevokeRow[],
): Promise<PlannedGoogleCalendarRevoke[]> {
  const primaries = rows.filter((row) => row.parentConnectionId === null);
  if (primaries.length === 0) return [];

  const subs = [
    ...new Set(
      primaries.flatMap((row) =>
        row.providerAccountSub ? [row.providerAccountSub] : [],
      ),
    ),
  ].sort();
  // Uden for savepointet, så låsene holdes til commit. Fejler en lås, er
  // transaktionen alligevel afbrudt, og fejlen skal op.
  for (const sub of subs) await lockGoogleCalendarAccount(tx, sub);

  const planned: PlannedGoogleCalendarRevoke[] = [];
  for (const row of primaries) {
    const brand = connectionOAuthBrand(row);
    const sub = row.providerAccountSub;
    if (!sub) {
      logSkipped(userId, brand, "no_account_id");
      continue;
    }
    try {
      await tx.transaction(async (sp) => {
        if ((await countAccountRows(sp, sub, row.id)) > 0) {
          logSkipped(userId, brand, "shared_account");
          return;
        }
        let token: string | null;
        try {
          token =
            decryptSecretOrNull(row.refreshToken) ||
            decryptSecretOrNull(row.accessToken);
        } catch {
          logFailed(userId, brand, "decrypt");
          return;
        }
        if (!token) {
          logSkipped(userId, brand, "no_token");
          return;
        }
        planned.push({ userId, brand, accountSub: sub, token });
      });
    } catch (error) {
      logFailed(
        userId,
        brand,
        error instanceof Error ? `db_${error.name}` : "db",
      );
    }
  }
  return planned;
}

/**
 * Kald Google for de besluttede tilbagekald. Kaldes med `db` efter commit af
 * den transaktion, der slettede rækkerne, aldrig inde i den. Hvert kald sker
 * i sin egen transaktion under kontoens lås, efter en ny optælling: har en
 * callback imens gemt en forbindelse til kontoen, tilbagekaldes der ikke, og
 * en callback, der kommer under kaldet, venter, til det er færdigt. Kaster
 * aldrig, så Google aldrig vælter en frakobling eller kontosletning.
 */
export async function executeGoogleCalendarRevokes(
  database: Pick<Db, "transaction">,
  revokes: PlannedGoogleCalendarRevoke[],
): Promise<void> {
  for (const { userId, brand, accountSub, token } of revokes) {
    try {
      await database.transaction(async (tx) => {
        await lockGoogleCalendarAccount(tx, accountSub);
        if ((await countAccountRows(tx, accountSub)) > 0) {
          logSkipped(userId, brand, "shared_account");
          return;
        }
        const result = await revokeToken(token);
        if (!result.ok) logFailed(userId, brand, result.reason, result.status);
      });
    } catch (error) {
      logFailed(
        userId,
        brand,
        error instanceof Error ? `db_${error.name}` : "db",
      );
    }
  }
}
