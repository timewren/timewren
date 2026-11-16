/**
 * Klientversion og minimumsversion.
 *
 * Alle TimeTrack-klienter sender `x-timetrack-client: <type>/<version>`
 * (fx `extension/2.5.2`, `mobile/1.0.0+5`, `web/0.1.0+<sha>`). Serveren
 * bruger det til tre ting:
 *
 * 1. Spor: hvilken klient og version står bag hver timer-skrivning
 *    (`timer_events.client_hint`) og hver Sentry-fejl (tags).
 * 2. Værn: skrivninger på timer-/tidsstierne fra en version under det
 *    konfigurerede minimum afvises med `CLIENT_TOO_OLD` — gamle klienter kan
 *    læse, men ikke ødelægge data. Minimum sættes i env
 *    `MIN_CLIENT_VERSIONS` (tom = ingen håndhævelse).
 * 3. Overblik: fordelingen af typer/versioner på /admin/stabilitet og
 *    stabilitetsvagtens `outdated_client`-detektor.
 *
 * Mangler headeren, er klienten "ukendt" og altid tilladt — API-nøgler, MCP
 * og scripts må aldrig brække. Eneste undtagelse er extension-origin uden
 * header: headeren kom med extension 2.5.2, så sådan et kald kommer fra
 * 2.5.1 eller ældre og vurderes som LEGACY_EXTENSION_VERSION.
 *
 * Rene funktioner uden server-afhængigheder, så web-klienten kan importere
 * konstanterne.
 */

export const CLIENT_HEADER = "x-timetrack-client";
export const CLIENT_TOO_OLD = "CLIENT_TOO_OLD";
/** Env-variablen med minimumsversioner pr. type. */
export const MIN_CLIENT_VERSIONS_ENV = "MIN_CLIENT_VERSIONS";
/**
 * `observe` = vurdér og vis på /admin/stabilitet (outdated_client), men
 * afvis ikke. Alt andet (også tom) = håndhæv.
 */
export const MIN_CLIENT_VERSIONS_MODE_ENV = "MIN_CLIENT_VERSIONS_MODE";

export function clientVersionEnforced(): boolean {
  return process.env[MIN_CLIENT_VERSIONS_MODE_ENV]?.trim() !== "observe";
}

export const CLIENT_KINDS = [
  "web",
  "pwa",
  "extension",
  "mobile",
  "desktop",
  "api",
  "mcp",
] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** Sidste extension-version der ikke sendte headeren. */
export const LEGACY_EXTENSION_VERSION = "2.5.1";

const MAX_VERSION_LENGTH = 32;
const MAX_HINT_LENGTH = 64;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

export function isClientKind(value: string): value is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(value);
}

export interface ClientHeader {
  kind: ClientKind;
  version: string;
}

/** `extension/2.5.2` → { kind, version }; alt andet → null. */
export function parseClientHeader(
  raw: string | null | undefined,
): ClientHeader | null {
  if (!raw) return null;
  const value = raw.trim();
  const slash = value.indexOf("/");
  if (slash <= 0) return null;
  const kind = value.slice(0, slash).toLowerCase();
  const version = value.slice(slash + 1);
  if (!isClientKind(kind)) return null;
  if (
    !version ||
    version.length > MAX_VERSION_LENGTH ||
    !VERSION_RE.test(version)
  ) {
    return null;
  }
  return { kind, version };
}

export function formatClientHeader(kind: ClientKind, version: string): string {
  return `${kind}/${version}`;
}

export interface ParsedVersion {
  /** major.minor.patch + Chromes valgfri fjerde del (0 når den mangler) */
  parts: [number, number, number, number];
  /** Numerisk build-nummer efter `+` (mobil: buildNumber), ellers null */
  build: number | null;
}

/** `1.2.3+45` → { parts: [1,2,3,0], build: 45 }. Ikke-semver → null. */
export function parseVersion(
  raw: string | null | undefined,
): ParsedVersion | null {
  if (!raw) return null;
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:\+(.+))?$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const build = m[5] && /^\d+$/.test(m[5]) ? Number(m[5]) : null;
  return {
    parts: [
      Number(m[1]),
      Number(m[2] ?? 0),
      Number(m[3] ?? 0),
      Number(m[4] ?? 0),
    ],
    build,
  };
}

/**
 * -1/0/1 som en comparator; null når en af siderne ikke er en version
 * (fx en git-SHA). Build sammenlignes kun når minimummet (`b`) har et;
 * mangler klientens build på samme version, kan det ikke afgøres (null =
 * ukendt, altså tilladt). Mobil skal derfor sende et numerisk `+build`.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] < pb.parts[i] ? -1 : 1;
  }
  if (pb.build !== null) {
    if (pa.build === null) return null;
    if (pa.build !== pb.build) return pa.build < pb.build ? -1 : 1;
  }
  return 0;
}

export type MinClientVersions = Partial<Record<ClientKind, string>>;

/** Som parseMinClientVersions, men med de poster der blev sprunget over. */
export function parseMinClientVersionsDetailed(
  raw: string | null | undefined,
): { minimums: MinClientVersions; invalid: string[] } {
  const minimums: MinClientVersions = {};
  const invalid: string[] = [];
  if (!raw) return { minimums, invalid };
  for (const pair of raw.split(",")) {
    const entry = pair.trim();
    if (!entry) continue;
    const [k, v] = entry.split("=").map((s) => s?.trim() ?? "");
    const kind = k?.toLowerCase();
    if (!kind || !isClientKind(kind) || !v || !parseVersion(v)) {
      // "web=" (tom værdi) er bevidst "intet minimum", ikke en fejl
      if (!(kind && isClientKind(kind) && !v)) invalid.push(entry);
      continue;
    }
    minimums[kind] = v;
  }
  return { minimums, invalid };
}

/** `extension=2.5.2,mobile=1.0.0+5` → { extension, mobile }. */
export function parseMinClientVersions(
  raw: string | null | undefined,
): MinClientVersions {
  return parseMinClientVersionsDetailed(raw).minimums;
}

let cachedEnvRaw: string | undefined;
let cachedEnvParsed: MinClientVersions = {};

/** Minimumsversionerne fra env (læses ved hvert kald, parses kun ved ændring). */
export function minClientVersionsFromEnv(): MinClientVersions {
  const raw = process.env[MIN_CLIENT_VERSIONS_ENV];
  if (raw !== cachedEnvRaw) {
    cachedEnvRaw = raw;
    const { minimums, invalid } = parseMinClientVersionsDetailed(raw);
    cachedEnvParsed = minimums;
    // Logges én gang pr. env-værdi (parses kun ved ændring)
    if (invalid.length > 0) {
      console.warn(
        `[ClientVersion] Ugyldige poster i ${MIN_CLIENT_VERSIONS_ENV} ignoreres: ${invalid.join(", ")}`,
      );
    }
  }
  return cachedEnvParsed;
}

export interface RequestClient {
  kind: ClientKind | null;
  version: string | null;
  /** true = fra headeren; false = gættet (origin) eller ukendt */
  declared: boolean;
}

const EXTENSION_ORIGINS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
];

/**
 * Hvem kalder? Headeren først, ellers ukendt. Extension-origin uden header
 * tolkes kun som extension ≤ 2.5.1, når kaldet rammer extensionens egne
 * procedurer (`extension.*`) — aldrig for REST v1/API-nøgler, der tilfældigvis
 * kommer fra en chrome-extension://-origin.
 */
export function resolveRequestClient(
  headers: Pick<Headers, "get"> | null | undefined,
  path?: string,
): RequestClient {
  if (!headers) return { kind: null, version: null, declared: false };
  const parsed = parseClientHeader(headers.get(CLIENT_HEADER));
  if (parsed) return { ...parsed, declared: true };
  const origin = headers.get("origin") ?? "";
  if (
    path?.startsWith("extension.") &&
    EXTENSION_ORIGINS.some((p) => origin.startsWith(p))
  ) {
    return {
      kind: "extension",
      version: LEGACY_EXTENSION_VERSION,
      declared: false,
    };
  }
  return { kind: null, version: null, declared: false };
}

/**
 * Skrivninger der kan ødelægge timer-/tidsdata. Læsninger og login er altid
 * tilladt, så en gammel klient kan vise data og logge ind for at opdatere.
 */
const GUARDED_ROUTERS = new Set(["timerSync", "extension", "time"]);
const UNGUARDED_PATHS = new Set([
  "extension.generateToken",
  "extension.revokeToken",
]);

export function isGuardedWritePath(path: string, type: string): boolean {
  if (type !== "mutation") return false;
  if (UNGUARDED_PATHS.has(path)) return false;
  const router = path.split(".")[0];
  return GUARDED_ROUTERS.has(router);
}

export type VersionVerdict =
  | { status: "ok" }
  | { status: "unknown" }
  | { status: "too_old"; kind: ClientKind; minimum: string };

export function evaluateClientVersion(
  client: RequestClient,
  minimums: MinClientVersions,
): VersionVerdict {
  if (!client.kind || !client.version) return { status: "unknown" };
  const minimum = minimums[client.kind];
  if (!minimum) return { status: "ok" };
  const cmp = compareVersions(client.version, minimum);
  if (cmp === null) return { status: "unknown" };
  return cmp < 0
    ? { status: "too_old", kind: client.kind, minimum }
    : { status: "ok" };
}

const CLIENT_NOUNS: Record<ClientKind, string> = {
  web: "TimeTrack-fane",
  pwa: "TimeTrack-app",
  extension: "TimeTrack-udvidelse",
  mobile: "TimeTrack-app",
  desktop: "TimeTrack-desktopapp",
  api: "TimeTrack-integration",
  mcp: "TimeTrack-integration",
};

export function clientTooOldMessage(kind: ClientKind): string {
  return `Din ${CLIENT_NOUNS[kind]} er for gammel — opdatér for at fortsætte`;
}

/**
 * Hint til timer_events: `kind@version <grov familie>` når headeren er sendt,
 * ellers det gamle hint uændret. `@` forekommer aldrig i de gamle hints, så
 * fordelingen kan skelne dem.
 */
export function formatClientHint(
  client: RequestClient,
  legacyHint: string | null,
): string | null {
  if (!client.declared || !client.kind || !client.version) return legacyHint;
  const head = `${client.kind}@${client.version}`;
  const full = legacyHint ? `${head} ${legacyHint}` : head;
  return full.slice(0, MAX_HINT_LENGTH);
}

/** Type/version ud fra et gemt client_hint (nyt eller gammelt format). */
export function classifyClientHint(hint: string | null | undefined): {
  kind: ClientKind | null;
  version: string | null;
} {
  if (!hint) return { kind: null, version: null };
  const m = /^([a-z]+)@(\S+)/.exec(hint);
  if (m && isClientKind(m[1])) return { kind: m[1], version: m[2] };
  if (hint.startsWith("extension/"))
    return { kind: "extension", version: null };
  if (hint.startsWith("mobilapp/")) return { kind: "mobile", version: null };
  if (hint.startsWith("desktop-")) return { kind: "desktop", version: null };
  return { kind: null, version: null };
}
