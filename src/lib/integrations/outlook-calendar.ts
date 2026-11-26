/**
 * Outlook-kalender via Microsoft Graph (read-only).
 *
 * OAuth 2.0 authorization code flow mod
 * `login.microsoftonline.com/<tenant>/oauth2/v2.0` med signeret `state`
 * (calendar-oauth-state.ts) og PKCE (S256). Scopes: `offline_access User.Read
 * Calendars.Read`. Der findes ingen skrivende Outlook-funktion, så der bedes
 * aldrig om Calendars.ReadWrite.
 *
 * Klienten vælges pr. brand (calendar-oauth-clients.ts) og gemmes på
 * forbindelsen (`oauth_brand`), så refresh altid bruger den klient, der
 * udstedte tokens. Tokens krypteres i hvile med encryptSecret.
 *
 * Synk: `/me/calendarView` for samme vindue som iCloud (30 dage tilbage, 90
 * frem) ind i calendar_events via den fælles planlægger (caldav/sync-plan.ts),
 * så synk-filtre, privatlivstilstand, matching og auto-track virker ens for
 * alle udbydere. Hændelser, der forsvinder fra vinduet, markeres aflyst.
 */

import crypto from "node:crypto";
import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { syncT } from "@/i18n/sync-text";
import type { BrandKey } from "@/lib/brands/registry";
import type { SyncFilters } from "@/lib/calendar/sync-filters";
import { db } from "@/lib/db";
import { calendarConnections, calendarEvents } from "@/lib/db/schema";
import {
  decryptSecretOrNull,
  EncryptionKeyError,
  encryptSecret,
  encryptSecretOrNull,
} from "@/lib/utils/encryption";
import { fetchWithTimeout } from "./base";
import type { CalDavResponseStatus } from "./caldav/ics";
import {
  type IncomingCalDavEvent,
  type PrivacyMode,
  planCalDavSync,
} from "./caldav/sync-plan";
import {
  connectionOAuthBrand,
  outlookCalendarClient,
} from "./calendar-oauth-clients";
import { createCalendarOAuthState } from "./calendar-oauth-state";

export const OUTLOOK_PROVIDER = "outlook";
export const OUTLOOK_SCOPES = [
  "offline_access",
  "User.Read",
  "Calendars.Read",
] as const;

const GRAPH_URL = "https://graph.microsoft.com/v1.0";
const LOGIN_URL = "https://login.microsoftonline.com";
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 90;
/** Cron og "Synkroniser nu" må ikke køre samtidig for samme forbindelse. */
const SYNC_CLAIM_WINDOW_MS = 2 * 60 * 1000;
/** Forny adgangstokenet lidt før udløb. */
const REFRESH_SKEW_MS = 60 * 1000;
/** Loft over sider pr. synk (100 hændelser pr. side). */
const MAX_PAGES = 50;
const MAX_EXTERNAL_ID_LENGTH = 255;

export const OUTLOOK_RECONNECT_ERROR =
  "Token expired. Please reconnect your calendar.";

export function isOutlookCalendarAvailableForBrand(brand: BrandKey): boolean {
  return outlookCalendarClient(brand) !== null;
}

function requireClient(brand: BrandKey) {
  const client = outlookCalendarClient(brand);
  if (!client) throw new Error("Outlook Calendar credentials not configured");
  return client;
}

function tenantPath(tenant: string): string {
  return `${LOGIN_URL}/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

// PKCE (RFC 7636)
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export interface OutlookAuthorizationRequest {
  url: string;
  state: string;
  /** Rå PKCE-verifier: gemmes i en HttpOnly-cookie til callbacken. */
  codeVerifier: string;
}

export function buildOutlookAuthorizationRequest(params: {
  brand: BrandKey;
  userId: string;
  loginHint?: string | null;
}): OutlookAuthorizationRequest {
  const client = requireClient(params.brand);
  const state = createCalendarOAuthState({
    userId: params.userId,
    brand: params.brand,
    provider: "outlook",
  });
  const codeVerifier = generateCodeVerifier();
  const query = new URLSearchParams({
    client_id: client.clientId,
    response_type: "code",
    redirect_uri: client.redirectUri,
    response_mode: "query",
    scope: OUTLOOK_SCOPES.join(" "),
    state,
    code_challenge: deriveCodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (params.loginHint) query.set("login_hint", params.loginHint);
  return {
    url: `${tenantPath(client.tenant)}/authorize?${query.toString()}`,
    state,
    codeVerifier,
  };
}

export interface OutlookTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  grantedScopes: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Token-fejl, der betyder at brugerens refresh-token ikke længere gælder. */
const REFRESH_REJECTED_CODES = new Set([
  "invalid_grant",
  "interaction_required",
]);

class OutlookTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "OutlookTokenError";
  }
}

async function postToken(
  brand: BrandKey,
  body: Record<string, string>,
): Promise<OutlookTokens> {
  const client = requireClient(brand);
  const res = await fetchWithTimeout(`${tenantPath(client.tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scope: OUTLOOK_SCOPES.join(" "),
      ...body,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    // Kun fejlkoden logges/returneres; Microsofts beskrivelse kan indeholde
    // korrelations-id'er, men aldrig tokens.
    throw new OutlookTokenError(
      `Microsoft token request failed (${res.status}${data.error ? `: ${data.error}` : ""})`,
      res.status,
      data.error,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    tokenExpiry:
      typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
    grantedScopes: data.scope
      ? [...new Set(data.scope.split(/\s+/).filter(Boolean))].sort().join(" ")
      : null,
  };
}

async function graphGet<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      // Alle tider i UTC, så de kan gemmes direkte som Date
      Prefer: 'outlook.timezone="UTC", odata.maxpagesize=100',
    },
  });
  if (!res.ok) {
    throw new GraphError(res.status);
  }
  return (await res.json()) as T;
}

export class GraphError extends Error {
  constructor(readonly status: number) {
    super(`Microsoft Graph request failed (${status})`);
    this.name = "GraphError";
  }
}

/** Code → tokens (med PKCE-verifier) + kontoens adresse fra /me. */
export async function exchangeOutlookCode(params: {
  brand: BrandKey;
  code: string;
  codeVerifier: string;
}): Promise<OutlookTokens & { accountEmail: string | null }> {
  const client = requireClient(params.brand);
  const tokens = await postToken(params.brand, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: client.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const me = await graphGet<{
    mail?: string | null;
    userPrincipalName?: string | null;
  }>(tokens.accessToken, `${GRAPH_URL}/me?$select=mail,userPrincipalName`);
  return {
    ...tokens,
    accountEmail: me.mail || me.userPrincipalName || null,
  };
}

async function findPrimary(userId: string) {
  return db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, OUTLOOK_PROVIDER),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
}

/**
 * Gem eller opdatér Outlook-forbindelsen. Tokens krypteres, før databasen
 * røres; mangler ENCRYPTION_KEY, gemmes intet.
 */
export async function saveOutlookConnection(params: {
  userId: string;
  orgId: string | null;
  brand: BrandKey;
  tokens: OutlookTokens & { accountEmail: string | null };
}): Promise<string> {
  const { tokens } = params;
  const accessToken = encryptSecret(tokens.accessToken);
  const refreshToken = encryptSecretOrNull(tokens.refreshToken);

  const existing = await findPrimary(params.userId);
  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        accessToken,
        refreshToken: refreshToken ?? existing.refreshToken,
        tokenExpiry: tokens.tokenExpiry,
        grantedScopes: tokens.grantedScopes ?? existing.grantedScopes,
        providerAccountId: tokens.accountEmail ?? existing.providerAccountId,
        oauthBrand: params.brand,
        syncEnabled: true,
        syncError: null,
        consecutiveSyncFailures: 0,
        syncDisabledUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));
    return existing.id;
  }

  // Kalenderindstillingerne er brugerens: arv dem fra en anden udbyder.
  const settingsSource = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, params.userId),
      isNull(calendarConnections.parentConnectionId),
    ),
  });

  const [row] = await db
    .insert(calendarConnections)
    .values({
      userId: params.userId,
      organizationId: params.orgId,
      provider: OUTLOOK_PROVIDER,
      oauthBrand: params.brand,
      providerAccountId: tokens.accountEmail,
      accessToken,
      refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      grantedScopes: tokens.grantedScopes,
      calendarId: "primary",
      calendarName: "Outlook",
      syncEnabled: true,
      syncDirection: "inbound",
      syncFilters: settingsSource?.syncFilters ?? null,
      privacyMode: settingsSource?.privacyMode ?? "off",
      autoTrackMode: settingsSource?.autoTrackMode ?? "suggest",
      defaultProjectId: settingsSource?.defaultProjectId ?? null,
    })
    .returning({ id: calendarConnections.id });
  return row.id;
}

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof findPrimary>>>;

async function markNeedsReconnect(connectionId: string, message: string) {
  await db
    .update(calendarConnections)
    .set({ syncEnabled: false, syncError: message, updatedAt: new Date() })
    .where(eq(calendarConnections.id, connectionId));
}

/**
 * Et gyldigt adgangstoken for forbindelsen. Fornyer med forbindelsens egen
 * klient (`oauth_brand`), når det er (ved at være) udløbet. Returnerer null,
 * når brugeren skal forbinde igen (forbindelsen slås fra med en besked).
 */
export async function getOutlookAccessToken(
  connection: ConnectionRow,
): Promise<string | null> {
  // Kaster ved manglende/forkert ENCRYPTION_KEY: en serverfejl, som ikke må
  // slå brugerens synk fra.
  const accessToken = decryptSecretOrNull(connection.accessToken);
  const refreshToken = decryptSecretOrNull(connection.refreshToken);

  const fresh =
    accessToken &&
    connection.tokenExpiry &&
    connection.tokenExpiry.getTime() - REFRESH_SKEW_MS > Date.now();
  if (fresh) return accessToken;

  if (!refreshToken) {
    await markNeedsReconnect(connection.id, OUTLOOK_RECONNECT_ERROR);
    return null;
  }

  try {
    const tokens = await postToken(connectionOAuthBrand(connection), {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    await db
      .update(calendarConnections)
      .set({
        accessToken: encryptSecret(tokens.accessToken),
        // Microsoft roterer refresh-tokenet; behold det gamle, hvis intet nyt
        refreshToken: tokens.refreshToken
          ? encryptSecret(tokens.refreshToken)
          : connection.refreshToken,
        tokenExpiry: tokens.tokenExpiry,
        grantedScopes: tokens.grantedScopes ?? connection.grantedScopes,
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connection.id));
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof EncryptionKeyError) throw error;
    console.error(
      "[Outlook] Token refresh failed:",
      error instanceof Error ? error.message : error,
    );
    // Kun et afvist refresh-token kræver ny forbindelse. Øvrige fejl
    // (invalid_client ved udløbet/roteret secret, 429, netværk, 5xx) gælder
    // appen eller er forbigående og prøves igen ved næste synk, så ikke
    // alle brugere skal forbinde manuelt igen, når secret er rettet.
    if (
      error instanceof OutlookTokenError &&
      error.code !== undefined &&
      REFRESH_REJECTED_CODES.has(error.code)
    ) {
      await markNeedsReconnect(
        connection.id,
        "Failed to refresh token. Please reconnect your calendar.",
      );
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Synk
// ---------------------------------------------------------------------------

interface GraphDateTime {
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GraphEvent {
  id?: string;
  subject?: string | null;
  bodyPreview?: string | null;
  location?: { displayName?: string | null } | null;
  start?: GraphDateTime | null;
  end?: GraphDateTime | null;
  isAllDay?: boolean | null;
  isCancelled?: boolean | null;
  responseStatus?: { response?: string | null } | null;
  changeKey?: string | null;
  originalStartTimeZone?: string | null;
}

const RESPONSE_MAP: Record<string, CalDavResponseStatus> = {
  accepted: "accepted",
  organizer: "accepted",
  declined: "declined",
  tentativelyAccepted: "tentative",
  notResponded: "needsAction",
};

/** Graph-tid i UTC (Prefer: outlook.timezone="UTC") → Date. */
function parseGraphTime(
  value: GraphDateTime | null | undefined,
  allDay: boolean,
) {
  const raw = value?.dateTime;
  if (!raw) return null;
  // Heldagshændelser: datoen alene, som Googles `date` (UTC-midnat)
  if (allDay) {
    const d = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Graph-hændelse → den fælles form, planlæggeren forstår. */
export function mapGraphEvent(event: GraphEvent): IncomingCalDavEvent | null {
  if (!event.id || event.id.length > MAX_EXTERNAL_ID_LENGTH) return null;
  const isAllDay = Boolean(event.isAllDay);
  const startTime = parseGraphTime(event.start, isAllDay);
  const endTime = parseGraphTime(event.end, isAllDay);
  if (!startTime || !endTime) return null;
  const response = event.responseStatus?.response ?? null;
  return {
    externalId: event.id,
    uid: event.id,
    title: event.subject?.trim() || null,
    description: event.bodyPreview?.trim() || null,
    location: event.location?.displayName?.trim() || null,
    startTime,
    endTime,
    isAllDay,
    timezone: event.originalStartTimeZone ?? null,
    isCancelled: Boolean(event.isCancelled),
    responseStatus: response ? (RESPONSE_MAP[response] ?? null) : null,
    etag: event.changeKey ?? null,
  };
}

export interface OutlookSyncResult {
  success: boolean;
  synced: number;
  updated: number;
  deleted: number;
  filtered: number;
  total: number;
  incremental: boolean;
  needsReconnect?: boolean;
  error?: string;
}

function emptyResult(error?: string): OutlookSyncResult {
  return {
    success: !error,
    synced: 0,
    updated: 0,
    deleted: 0,
    filtered: 0,
    total: 0,
    incremental: false,
    ...(error ? { error } : {}),
  };
}

async function fetchCalendarView(
  accessToken: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ events: GraphEvent[]; complete: boolean }> {
  const select = [
    "id",
    "subject",
    "bodyPreview",
    "location",
    "start",
    "end",
    "isAllDay",
    "isCancelled",
    "responseStatus",
    "changeKey",
    "originalStartTimeZone",
  ].join(",");
  let url: string | undefined =
    `${GRAPH_URL}/me/calendarView?${new URLSearchParams({
      startDateTime: rangeStart.toISOString(),
      endDateTime: rangeEnd.toISOString(),
      $select: select,
      $top: "100",
    }).toString()}`;
  const events: GraphEvent[] = [];
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } =
      await graphGet(accessToken, url);
    events.push(...(page.value ?? []));
    const next: string | undefined = page["@odata.nextLink"];
    // Følg kun Graphs egne links (tokenet må aldrig sendes andre steder hen)
    url = next?.startsWith(`${GRAPH_URL}/`) ? next : undefined;
    pages++;
  }
  return { events, complete: !url };
}

/**
 * Hent Outlook-hændelser for synk-vinduet og planlæg dem ind i
 * calendar_events. `force` springer den samtidige-synk-lås over.
 */
export async function syncOutlookCalendar(
  userId: string,
  options: { force?: boolean } = {},
): Promise<OutlookSyncResult> {
  const connection = await findPrimary(userId);
  if (!connection) {
    return emptyResult(syncT("integrations.outlook.notConnected"));
  }
  if (!connection.syncEnabled) {
    return {
      ...emptyResult(connection.syncError ?? OUTLOOK_RECONNECT_ERROR),
      needsReconnect: true,
    };
  }

  const now = new Date();
  const claimed = await db
    .update(calendarConnections)
    .set({ lastSynced: now })
    .where(
      and(
        eq(calendarConnections.id, connection.id),
        options.force
          ? undefined
          : or(
              isNull(calendarConnections.lastSynced),
              lt(
                calendarConnections.lastSynced,
                new Date(now.getTime() - SYNC_CLAIM_WINDOW_MS),
              ),
            ),
      ),
    )
    .returning({ id: calendarConnections.id });
  if (claimed.length === 0) return { ...emptyResult(), incremental: true };

  try {
    const accessToken = await getOutlookAccessToken(connection);
    if (!accessToken) {
      return {
        ...emptyResult(OUTLOOK_RECONNECT_ERROR),
        needsReconnect: true,
      };
    }

    const rangeStart = new Date(now.getTime() - SYNC_PAST_DAYS * 86_400_000);
    const rangeEnd = new Date(now.getTime() + SYNC_FUTURE_DAYS * 86_400_000);
    const { events, complete } = await fetchCalendarView(
      accessToken,
      rangeStart,
      rangeEnd,
    );

    const incoming: IncomingCalDavEvent[] = [];
    let unreadable = 0;
    for (const event of events) {
      const mapped = mapGraphEvent(event);
      if (mapped) incoming.push(mapped);
      else unreadable++;
    }

    const existing = await db.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.calendarConnectionId, connection.id),
        gte(calendarEvents.endTime, rangeStart),
        lte(calendarEvents.startTime, rangeEnd),
      ),
    });

    const plan = planCalDavSync(existing, incoming, {
      privacyMode: (connection.privacyMode ?? "off") as PrivacyMode,
      filters: (connection.syncFilters as SyncFilters | null) ?? null,
      // Ufuldstændigt svar: en manglende hændelse er ikke nødvendigvis slettet
      cancelMissing: complete && unreadable === 0,
    });

    for (const values of plan.inserts) {
      await db.insert(calendarEvents).values({
        userId,
        organizationId: connection.organizationId,
        calendarConnectionId: connection.id,
        eventType: "external",
        syncDirection: "inbound",
        lastSyncedAt: now,
        ...values,
      });
    }
    for (const { id, values } of plan.updates) {
      await db
        .update(calendarEvents)
        .set({ ...values, lastSyncedAt: now, updatedAt: now })
        .where(eq(calendarEvents.id, id));
    }
    for (const id of plan.cancels) {
      await db
        .update(calendarEvents)
        .set({ isCancelled: true, updatedAt: now })
        .where(eq(calendarEvents.id, id));
    }

    await db
      .update(calendarConnections)
      .set({ lastSynced: now, syncError: null, updatedAt: now })
      .where(eq(calendarConnections.id, connection.id));

    return {
      success: true,
      synced: plan.inserts.length,
      updated: plan.updates.length,
      deleted: plan.cancels.length,
      filtered: plan.filtered,
      total: incoming.length,
      incremental: false,
    };
  } catch (error) {
    if (error instanceof EncryptionKeyError) throw error;
    // 401 fra Graph med et access-token, vi tror gyldigt (fx tilbagekaldt
    // samtykke): markér tokenet udløbet, så næste synk forsøger refresh. Et
    // afvist refresh (invalid_grant) slår så forbindelsen fra med
    // "Forbind igen"-knap; indtil da vises en neutral fejl, ikke
    // reconnect-teksten uden knap.
    if (error instanceof GraphError && error.status === 401) {
      await db
        .update(calendarConnections)
        .set({ tokenExpiry: null })
        .where(eq(calendarConnections.id, connection.id));
    }
    const message = syncT("integrations.outlook.syncFailed");
    console.error(
      "[Outlook Sync] Fejlede:",
      error instanceof Error ? error.message : error,
    );
    await db
      .update(calendarConnections)
      .set({ syncError: message, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connection.id));
    return emptyResult(message);
  }
}

/** Status til UI og widgets — viser aldrig tokens. */
export async function getOutlookStatus(userId: string) {
  const connection = await findPrimary(userId);
  if (!connection) {
    return {
      connected: false as const,
      accountEmail: null,
      needsReconnect: false,
      lastSynced: null,
      error: null,
    };
  }
  return {
    connected: true as const,
    accountEmail: connection.providerAccountId,
    needsReconnect: !connection.syncEnabled,
    lastSynced: connection.lastSynced,
    error: connection.syncError,
  };
}

/**
 * Afbryd Outlook: sletter forbindelsen og dermed tokens (hændelserne følger
 * med via cascade). Google og iCloud røres ikke.
 */
export async function disconnectOutlook(userId: string) {
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, OUTLOOK_PROVIDER),
      ),
    );
}
