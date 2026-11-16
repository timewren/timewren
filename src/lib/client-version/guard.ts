import { TRPCError } from "@trpc/server";
import {
  CLIENT_TOO_OLD,
  type ClientKind,
  clientTooOldMessage,
  clientVersionEnforced,
  evaluateClientVersion,
  isGuardedWritePath,
  type MinClientVersions,
  minClientVersionsFromEnv,
  type RequestClient,
  resolveRequestClient,
} from "./index";

/**
 * Server-side værn mod for gamle klienter. Bruges af tRPC-middlewaren (som
 * også dækker REST v1 og MCP, der kalder routeren via createCaller) og af
 * desktop-sync-ruterne, der skriver direkte i databasen.
 */

/** Årsagen bag en CLIENT_TOO_OLD-afvisning (læses af errorFormatter/REST). */
export class ClientTooOldError extends Error {
  readonly appCode = CLIENT_TOO_OLD;
  constructor(
    readonly kind: ClientKind,
    readonly minimum: string,
    readonly version: string | null,
    /**
     * true = extension uden header (≤ 2.5.1). Den svares med 503 i stedet
     * for 412: 2.5.1's offline-kø opgiver en tidsregistrering ved enhver
     * sikker 4xx ("registrér den manuelt"), men prøver igen ved 5xx — så
     * køen bevares, til brugeren har opdateret.
     */
    readonly legacy: boolean = false,
  ) {
    super(clientTooOldMessage(kind));
    this.name = "ClientTooOldError";
  }
}

/** Navnet tjekkes også: klassen kan dubleres på tværs af server-chunks. */
export function isClientTooOldError(err: unknown): err is ClientTooOldError {
  return (
    err instanceof ClientTooOldError ||
    (err instanceof Error && err.name === "ClientTooOldError")
  );
}

/** Er en TRPCError (eller dens årsag) en CLIENT_TOO_OLD-afvisning? */
export function clientTooOldCause(err: unknown): ClientTooOldError | null {
  if (isClientTooOldError(err)) return err;
  if (err instanceof Error && isClientTooOldError(err.cause)) return err.cause;
  return null;
}

/** Retry-After på 503-svaret til extension ≤ 2.5.1. */
export const LEGACY_RETRY_AFTER_SECONDS = 600;

/**
 * Stier en extension ≤ 2.5.1 stadig må kalde, selv når den er under
 * minimum: confirmStop afslutter et stop hvis tid ALLEREDE er gemt (serverens
 * versionstjek gør et sent kald sikkert). Afvises den, opgiver 2.5.1 den
 * efter tre forsøg, og rækken bliver hængende i "stopping" — den klasse af
 * fejl, minimummet skal forhindre.
 */
const LEGACY_ALLOWED_PATHS = new Set(["extension.confirmStop"]);

/** Retry-After-sekunder, hvis nogen af fejlene er en legacy-afvisning. */
export function clientTooOldRetryAfterSeconds(
  errors: readonly unknown[],
): number | null {
  return errors.some((e) => clientTooOldCause(e)?.legacy)
    ? LEGACY_RETRY_AFTER_SECONDS
    : null;
}

const REJECT_LOG_INTERVAL_MS = 10 * 60_000;
const MAX_REJECT_LOG_KEYS = 200;
const lastRejectLog = new Map<string, number>();

function logRejection(client: RequestClient, minimum: string, path: string) {
  const key = `${client.kind}@${client.version}`;
  const now = Date.now();
  if (now - (lastRejectLog.get(key) ?? 0) < REJECT_LOG_INTERVAL_MS) return;
  // Versionen kommer fra en header, før login — hold mappet lille, så
  // mange opdigtede versioner ikke kan æde hukommelse.
  if (lastRejectLog.size >= MAX_REJECT_LOG_KEYS) lastRejectLog.clear();
  lastRejectLog.set(key, now);
  console.warn(
    `[ClientVersion] Afviser skrivning fra ${key}${client.declared ? "" : " (uden header)"} — minimum ${minimum} (${path}; logges højst hvert 10. min pr. version)`,
  );
}

export interface ClientVersionCheck {
  client: RequestClient;
  /** true når kaldet er en beskyttet skrivning */
  guarded: boolean;
}

/**
 * Afgør klienten for et kald og kaster CLIENT_TOO_OLD hvis det er en
 * beskyttet skrivning fra en version under minimum: PRECONDITION_FAILED
 * (412) for klienter der sender headeren, SERVICE_UNAVAILABLE (503) for
 * extension ≤ 2.5.1 uden header (se ClientTooOldError.legacy).
 * Læsninger og ukendte klienter slipper altid igennem.
 */
export function enforceClientVersion(input: {
  headers: Pick<Headers, "get"> | null | undefined;
  path: string;
  type: string;
  minimums?: MinClientVersions;
  enforce?: boolean;
}): ClientVersionCheck {
  const client = resolveRequestClient(input.headers, input.path);
  const guarded = isGuardedWritePath(input.path, input.type);
  if (!guarded) return { client, guarded };
  if (!client.declared && LEGACY_ALLOWED_PATHS.has(input.path)) {
    return { client, guarded };
  }
  const verdict = evaluateClientVersion(
    client,
    input.minimums ?? minClientVersionsFromEnv(),
  );
  if (
    verdict.status === "too_old" &&
    (input.enforce ?? clientVersionEnforced())
  ) {
    logRejection(client, verdict.minimum, input.path);
    const legacy = !client.declared;
    const cause = new ClientTooOldError(
      verdict.kind,
      verdict.minimum,
      client.version,
      legacy,
    );
    throw new TRPCError({
      code: legacy ? "SERVICE_UNAVAILABLE" : "PRECONDITION_FAILED",
      message: cause.message,
      cause,
    });
  }
  return { client, guarded };
}

/**
 * Samme vurdering for REST-ruter uden tRPC (desktop-sync). Returnerer
 * afvisningen i stedet for at kaste, så ruten kan svare HTTP 426. En
 * ukendt klient (ingen header) afvises aldrig.
 */
export function checkRestClientVersion(
  headers: Pick<Headers, "get"> | null | undefined,
  minimums: MinClientVersions = minClientVersionsFromEnv(),
): ClientTooOldError | null {
  if (!clientVersionEnforced()) return null;
  const client = resolveRequestClient(headers);
  const verdict = evaluateClientVersion(client, minimums);
  if (verdict.status !== "too_old") return null;
  logRejection(client, verdict.minimum, "rest");
  return new ClientTooOldError(verdict.kind, verdict.minimum, client.version);
}

/** JSON-kroppen for et HTTP 426-svar. */
export function clientTooOldBody(err: ClientTooOldError) {
  return {
    error: {
      code: CLIENT_TOO_OLD,
      message: err.message,
      details: { kind: err.kind, minimumVersion: err.minimum },
    },
  };
}
