import { and, eq } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { extensionTokens } from "@/lib/db/schema";
import { tokenLookup } from "@/lib/security/token-hash";
import {
  clientHintFromHeaders,
  logTimerEvent,
  resolveTimerEventSource,
} from "@/lib/timer/events";
import type { ClientTooOldError } from "./guard";

/**
 * Afviste skrivninger fra for gamle klienter logges som timer-hændelsen
 * `client_too_old`, så stabilitetsvagten og /admin/stabilitet kan vise hvem
 * der stadig kører en gammel version — også når minimummet håndhæves (ellers
 * ville de afviste kald være usynlige i timer_events).
 *
 * Højst én hændelse pr. bruger+version pr. 10 minutter pr. proces: en gammel
 * extension prøver igen hvert heartbeat, og loggen skal vise "hvem", ikke
 * fylde op.
 */

type Db = typeof dbType;

const RECORD_INTERVAL_MS = 10 * 60_000;
const MAX_TRACKED = 5000;
const lastRecorded = new Map<string, number>();

function shouldRecord(key: string, now: number): boolean {
  const last = lastRecorded.get(key);
  if (last !== undefined && now - last < RECORD_INTERVAL_MS) return false;
  if (lastRecorded.size >= MAX_TRACKED) lastRecorded.clear();
  lastRecorded.set(key, now);
  return true;
}

/** Extension-kald bærer token i input — find brugeren bag (kun ved afvisning). */
async function userIdFromExtensionToken(
  database: Db,
  rawInput: unknown,
): Promise<string | null> {
  const input = (rawInput as { json?: unknown } | null)?.json ?? rawInput;
  const token = (input as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || !token) return null;
  const [row] = await database
    .select({ userId: extensionTokens.userId })
    .from(extensionTokens)
    .where(
      and(
        tokenLookup(extensionTokens.tokenHash, token),
        eq(extensionTokens.isRevoked, false),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

export async function recordClientTooOld(input: {
  db: Db;
  headers: Pick<Headers, "get"> | null | undefined;
  path: string;
  error: ClientTooOldError;
  userId: string | null | undefined;
  getRawInput?: () => Promise<unknown>;
  now?: number;
}): Promise<void> {
  try {
    const now = input.now ?? Date.now();
    let userId = input.userId ?? null;
    if (!userId && input.path.startsWith("extension.") && input.getRawInput) {
      userId = await userIdFromExtensionToken(
        input.db,
        await input.getRawInput(),
      );
    }
    if (!userId) return;
    const version = input.error.version ?? "ukendt";
    if (!shouldRecord(`${userId}|${input.error.kind}@${version}`, now)) return;
    const clientHint = clientHintFromHeaders(input.headers);
    await logTimerEvent(input.db, {
      userId,
      event: "client_too_old",
      source: resolveTimerEventSource(
        input.error.kind === "extension" ? "extension" : null,
        clientHint,
      ),
      clientHint,
      detail: {
        path: input.path,
        kind: input.error.kind,
        version: input.error.version,
        minimum: input.error.minimum,
      },
    });
  } catch (err) {
    console.error(
      "[ClientVersion] Afvisning kunne ikke logges:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Kun til tests. */
export function resetClientTooOldRecordThrottle() {
  lastRecorded.clear();
}
