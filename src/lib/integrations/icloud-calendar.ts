/**
 * iCloud-kalender via CalDAV (#676) — read-only.
 *
 * Datamodel (genbruger calendar_connections som Google):
 * - Én forælder-forbindelse pr. bruger (provider 'apple', parent_connection_id
 *   NULL) med Apple-ID i provider_account_id og det app-specifikke password
 *   krypteret i access_token. Forælderen bærer også de fælles indstillinger
 *   (synk-filtre, privatlivstilstand, auto-track).
 * - Én barne-forbindelse pr. valgt kalender (calendar_id = kalenderens
 *   CalDAV-URL). Hændelser hænger på barnet og slettes med det (cascade).
 *
 * TimeTrack skriver aldrig til iCloud.
 */

import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { syncT } from "@/i18n/sync-text";
import type { SyncFilters } from "@/lib/calendar/sync-filters";
import { db } from "@/lib/db";
import { calendarConnections, calendarEvents } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/utils/encryption";
import {
  CALDAV_AUTH_ERROR_MESSAGE,
  CalDavError,
  type CalDavSource,
  classifyCalDavError,
  createCalDavSource,
  isAllowedICloudUrl,
  type RemoteCalendar,
} from "./caldav/client";
import { type ParsedCalDavEvent, parseCalendarObject } from "./caldav/ics";
import {
  type IncomingCalDavEvent,
  type PrivacyMode,
  planCalDavSync,
} from "./caldav/sync-plan";

const PROVIDER = "apple";
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 90;
/** En synk, der startede inden for dette vindue, anses som stadig kørende */
const SYNC_CLAIM_WINDOW_MS = 2 * 60 * 1000;
/** Uændret ctag + synk inden for dette vindue → spring kalenderen over */
const CTAG_SKIP_WINDOW_MS = 6 * 60 * 60 * 1000;

type SourceFactory = typeof createCalDavSource;
let sourceFactory: SourceFactory = createCalDavSource;

/** Kun til tests: udskift CalDAV-klienten med en mock */
export function __setCalDavSourceFactoryForTests(factory: SourceFactory) {
  sourceFactory = factory;
}

type ConnectionRow = typeof calendarConnections.$inferSelect;

export class ICloudConnectError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "network" | "unknown" | "not_connected",
  ) {
    super(message);
    this.name = "ICloudConnectError";
  }
}

/**
 * Apple viser app-specifikke passwords som "abcd-efgh-ijkl-mnop". Folk
 * indsætter dem med mellemrum eller linjeskift — dem fjerner vi.
 */
export function normalizeAppPassword(password: string): string {
  return password.replace(/\s+/g, "");
}

export function normalizeAppleId(appleId: string): string {
  return appleId.trim().toLowerCase();
}

async function getParent(userId: string): Promise<ConnectionRow | undefined> {
  return db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, PROVIDER),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
}

async function getChildren(parentId: string, userId: string) {
  return db.query.calendarConnections.findMany({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.parentConnectionId, parentId),
    ),
  });
}

async function openSource(parent: ConnectionRow): Promise<CalDavSource> {
  if (!parent.accessToken || !parent.providerAccountId) {
    throw new CalDavError("auth", CALDAV_AUTH_ERROR_MESSAGE);
  }
  return sourceFactory({
    username: parent.providerAccountId,
    password: decrypt(parent.accessToken),
  });
}

/**
 * Forkert eller tilbagekaldt password: stop synk (så vi ikke hamrer Apple
 * med fejlende logins) og vis "forbind igen" i UI.
 */
export async function markICloudAuthFailure(parentId: string) {
  await db
    .update(calendarConnections)
    .set({
      syncEnabled: false,
      syncError: CALDAV_AUTH_ERROR_MESSAGE,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, parentId));
}

/**
 * Forbind (eller genforbind) iCloud. Validerer credentials mod Apple før
 * noget gemmes. Returnerer brugerens kalendere; ingen vælges automatisk.
 */
export async function connectICloud(params: {
  userId: string;
  orgId: string | null;
  appleId: string;
  appPassword: string;
}) {
  const appleId = normalizeAppleId(params.appleId);
  const password = normalizeAppPassword(params.appPassword);

  // Password må aldrig gemmes i klartekst: uden krypteringsnøgle (ENCRYPTION_KEY,
  // AES-256-GCM) afvises forbindelsen før vi overhovedet kontakter Apple.
  let encryptedPassword: string;
  try {
    encryptedPassword = encrypt(password);
  } catch (error) {
    console.error("[iCloud] Kryptering af app-password fejlede:", error);
    throw new ICloudConnectError(
      syncT("integrations.icloud.storageMissing"),
      "unknown",
    );
  }

  let calendars: RemoteCalendar[];
  try {
    const source = await sourceFactory({ username: appleId, password });
    calendars = await source.listCalendars();
  } catch (error) {
    const classified = classifyCalDavError(error);
    throw new ICloudConnectError(
      classified.kind === "auth"
        ? syncT("integrations.icloud.rejected")
        : classified.message,
      classified.kind,
    );
  }

  const existing = await getParent(params.userId);
  const now = new Date();

  if (existing) {
    // Nyt Apple-ID → de valgte kalendere hører til en anden konto
    if (existing.providerAccountId !== appleId) {
      await db
        .delete(calendarConnections)
        .where(
          and(
            eq(calendarConnections.userId, params.userId),
            eq(calendarConnections.parentConnectionId, existing.id),
          ),
        );
    }
    await db
      .update(calendarConnections)
      .set({
        providerAccountId: appleId,
        accessToken: encryptedPassword,
        syncEnabled: true,
        syncError: null,
        consecutiveSyncFailures: 0,
        syncDisabledUntil: null,
        updatedAt: now,
      })
      .where(eq(calendarConnections.id, existing.id));
  } else {
    // Arv de fælles kalenderindstillinger fra en anden udbyder: Google først
    // (som hidtil), ellers fx Outlook.
    const settingsSource =
      (await db.query.calendarConnections.findFirst({
        where: and(
          eq(calendarConnections.userId, params.userId),
          eq(calendarConnections.provider, "google"),
          isNull(calendarConnections.parentConnectionId),
        ),
      })) ??
      (await db.query.calendarConnections.findFirst({
        where: and(
          eq(calendarConnections.userId, params.userId),
          isNull(calendarConnections.parentConnectionId),
        ),
      }));
    await db.insert(calendarConnections).values({
      userId: params.userId,
      organizationId: params.orgId,
      provider: PROVIDER,
      providerAccountId: appleId,
      accessToken: encryptedPassword,
      refreshToken: null,
      tokenExpiry: null,
      calendarId: null,
      calendarName: "iCloud",
      syncEnabled: true,
      syncDirection: "inbound",
      syncFilters: settingsSource?.syncFilters ?? null,
      privacyMode: settingsSource?.privacyMode ?? "off",
      autoTrackMode: settingsSource?.autoTrackMode ?? "suggest",
      defaultProjectId: settingsSource?.defaultProjectId ?? null,
    });
  }

  return { calendars: calendars.map((c) => ({ ...c, selected: false })) };
}

/** Status til UI — viser aldrig password */
export async function getICloudStatus(userId: string) {
  const parent = await getParent(userId);
  if (!parent) {
    return {
      connected: false as const,
      appleId: null,
      needsReconnect: false,
      lastSynced: null,
      error: null,
      selectedCount: 0,
    };
  }
  const children = await getChildren(parent.id, userId);
  const lastSynced = children
    .map((c) => c.lastSynced)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const childError = children.find((c) => c.syncError)?.syncError ?? null;
  return {
    connected: true as const,
    appleId: parent.providerAccountId,
    needsReconnect: !parent.syncEnabled,
    lastSynced: lastSynced ?? parent.lastSynced ?? null,
    error: parent.syncError ?? childError,
    selectedCount: children.length,
  };
}

export async function listICloudCalendars(userId: string) {
  const parent = await getParent(userId);
  if (!parent) {
    throw new ICloudConnectError(
      syncT("integrations.icloud.notConnected"),
      "not_connected",
    );
  }
  let calendars: RemoteCalendar[];
  try {
    const source = await openSource(parent);
    calendars = await source.listCalendars();
  } catch (error) {
    const classified = classifyCalDavError(error);
    if (classified.kind === "auth") await markICloudAuthFailure(parent.id);
    throw new ICloudConnectError(classified.message, classified.kind);
  }
  const selected = new Set(
    (await getChildren(parent.id, userId)).map((c) => c.calendarId),
  );
  return calendars.map((c) => ({ ...c, selected: selected.has(c.url) }));
}

/**
 * Gem hvilke kalendere der skal læses. URL'erne valideres mod Apples egen
 * liste, så klienten ikke kan få os til at kalde en vilkårlig URL.
 */
export async function selectICloudCalendars(params: {
  userId: string;
  orgId: string | null;
  calendarUrls: string[];
}) {
  const remote = await listICloudCalendars(params.userId);
  const parent = await getParent(params.userId);
  if (!parent) {
    throw new ICloudConnectError(
      syncT("integrations.icloud.notConnected"),
      "not_connected",
    );
  }
  const children = await getChildren(parent.id, params.userId);
  if (remote.length === 0 && children.length > 0) {
    // Fejlet kalenderliste må ikke slette brugerens valg
    throw new ICloudConnectError(
      syncT("integrations.caldav.network"),
      "network",
    );
  }
  const remoteByUrl = new Map(remote.map((c) => [c.url, c]));
  const wanted = new Set(
    params.calendarUrls.filter(
      (url) => remoteByUrl.has(url) && isAllowedICloudUrl(url),
    ),
  );

  for (const child of children) {
    if (!child.calendarId || !wanted.has(child.calendarId)) {
      // Cascade fjerner kalenderens hændelser; tidsregistreringer bevares
      await db
        .delete(calendarConnections)
        .where(eq(calendarConnections.id, child.id));
    }
  }
  const existingUrls = new Set(children.map((c) => c.calendarId));
  for (const url of wanted) {
    if (existingUrls.has(url)) continue;
    const cal = remoteByUrl.get(url);
    await db.insert(calendarConnections).values({
      userId: params.userId,
      organizationId: params.orgId,
      provider: PROVIDER,
      providerAccountId: parent.providerAccountId,
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      calendarId: url,
      calendarName: cal?.displayName.slice(0, 255) ?? "iCloud",
      calendarColor: cal?.color ?? null,
      parentConnectionId: parent.id,
      syncEnabled: true,
      syncDirection: "inbound",
      autoTrackMode: parent.autoTrackMode,
    });
  }
  return { selectedCount: wanted.size };
}

export async function disconnectICloud(userId: string) {
  // Børn og deres hændelser forsvinder via cascade; Google røres ikke
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, PROVIDER),
      ),
    );
}

export interface ICloudSyncResult {
  success: boolean;
  synced: number;
  updated: number;
  deleted: number;
  filtered: number;
  total: number;
  calendarsSynced: number;
  incremental: boolean;
  needsReconnect?: boolean;
  error?: string;
}

function emptyResult(error?: string): ICloudSyncResult {
  return {
    success: !error,
    synced: 0,
    updated: 0,
    deleted: 0,
    filtered: 0,
    total: 0,
    calendarsSynced: 0,
    incremental: false,
    ...(error ? { error } : {}),
  };
}

async function syncChild(params: {
  userId: string;
  orgId: string | null;
  child: ConnectionRow;
  remote: RemoteCalendar;
  source: CalDavSource;
  selfEmails: string[];
  privacyMode: PrivacyMode;
  filters: SyncFilters | null;
  force: boolean;
  result: ICloudSyncResult;
}) {
  const { child, remote, result } = params;
  const now = new Date();

  const unchanged =
    !params.force &&
    remote.ctag &&
    child.syncToken === remote.ctag &&
    child.lastSynced &&
    now.getTime() - child.lastSynced.getTime() < CTAG_SKIP_WINDOW_MS;
  if (unchanged) {
    result.incremental = true;
    return;
  }

  const rangeStart = new Date(now.getTime() - SYNC_PAST_DAYS * 86_400_000);
  const rangeEnd = new Date(now.getTime() + SYNC_FUTURE_DAYS * 86_400_000);
  const objects = await params.source.fetchObjects(remote.url, {
    start: rangeStart,
    end: rangeEnd,
  });

  const incoming: IncomingCalDavEvent[] = [];
  let unreadable = 0;
  for (const object of objects) {
    let parsed: ParsedCalDavEvent[];
    try {
      parsed = parseCalendarObject(object.data, {
        rangeStart,
        rangeEnd,
        selfEmails: params.selfEmails,
      });
    } catch (error) {
      // Ét defekt objekt må ikke vælte hele kalenderen
      unreadable++;
      console.warn(
        `[iCloud Sync] Kunne ikke parse ${object.url}:`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    for (const event of parsed) incoming.push({ ...event, etag: object.etag });
  }

  const existing = await db.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.userId, params.userId),
      eq(calendarEvents.calendarConnectionId, child.id),
      gte(calendarEvents.endTime, rangeStart),
      lte(calendarEvents.startTime, rangeEnd),
    ),
  });

  const plan = planCalDavSync(existing, incoming, {
    privacyMode: params.privacyMode,
    filters: params.filters,
    cancelMissing: unreadable === 0,
  });

  for (const values of plan.inserts) {
    await db.insert(calendarEvents).values({
      userId: params.userId,
      organizationId: params.orgId,
      calendarConnectionId: child.id,
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
    .set({
      lastSynced: now,
      syncError: null,
      syncToken: remote.ctag,
      consecutiveSyncFailures: 0,
      syncDisabledUntil: null,
      updatedAt: now,
    })
    .where(eq(calendarConnections.id, child.id));

  result.synced += plan.inserts.length;
  result.updated += plan.updates.length;
  result.deleted += plan.cancels.length;
  result.filtered += plan.filtered;
  result.total += incoming.length;
}

/**
 * Hent hændelser fra de valgte iCloud-kalendere. Polling — ingen push.
 * `force` ignorerer ctag-genvejen (bruges når filtre/privatliv ændres).
 */
export async function syncICloudCalendars(
  userId: string,
  options: { force?: boolean } = {},
): Promise<ICloudSyncResult> {
  const parent = await getParent(userId);
  if (!parent)
    return emptyResult(syncT("integrations.icloud.notConnectedShort"));
  if (!parent.syncEnabled) {
    return {
      ...emptyResult(parent.syncError ?? CALDAV_AUTH_ERROR_MESSAGE),
      needsReconnect: true,
    };
  }

  const now = new Date();
  // Atomisk "claim": cron og "Synkroniser nu" må ikke køre samtidig for
  // samme bruger, ellers kan begge indsætte de samme hændelser.
  const claimed = await db
    .update(calendarConnections)
    .set({ lastSynced: now })
    .where(
      and(
        eq(calendarConnections.id, parent.id),
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
  if (claimed.length === 0) {
    return { ...emptyResult(), incremental: true };
  }

  const children = (await getChildren(parent.id, userId)).filter(
    (c) => c.syncEnabled,
  );
  if (children.length === 0) {
    await db
      .update(calendarConnections)
      .set({ lastSynced: now, updatedAt: now })
      .where(eq(calendarConnections.id, parent.id));
    return emptyResult();
  }

  let source: CalDavSource;
  let remote: RemoteCalendar[];
  try {
    source = await openSource(parent);
    remote = await source.listCalendars();
  } catch (error) {
    const classified = classifyCalDavError(error);
    if (classified.kind === "auth") {
      await markICloudAuthFailure(parent.id);
      return { ...emptyResult(classified.message), needsReconnect: true };
    }
    return emptyResult(classified.message);
  }
  if (remote.length === 0) {
    // tsdav filtrerer fejlsvar væk; en konto har altid mindst én kalender
    return emptyResult(syncT("integrations.caldav.network"));
  }

  const result = emptyResult();
  const remoteByUrl = new Map(remote.map((c) => [c.url, c]));
  const settings = {
    privacyMode: (parent.privacyMode ?? "off") as PrivacyMode,
    filters: (parent.syncFilters as SyncFilters | null) ?? null,
  };
  const selfEmails = parent.providerAccountId ? [parent.providerAccountId] : [];

  for (const child of children) {
    const childRemote = child.calendarId
      ? remoteByUrl.get(child.calendarId)
      : undefined;
    if (!childRemote || !isAllowedICloudUrl(childRemote.url)) {
      const message = syncT("integrations.icloud.calendarGone", {
        name:
          child.calendarName ?? syncT("integrations.icloud.unknownCalendar"),
      });
      await db
        .update(calendarConnections)
        .set({ syncError: message, updatedAt: now })
        .where(eq(calendarConnections.id, child.id));
      result.success = false;
      result.error = result.error ?? message;
      continue;
    }
    try {
      await syncChild({
        userId,
        orgId: parent.organizationId,
        child,
        remote: childRemote,
        source,
        selfEmails,
        ...settings,
        force: !!options.force,
        result,
      });
      result.calendarsSynced++;
    } catch (error) {
      const classified = classifyCalDavError(error);
      if (classified.kind === "auth") {
        await markICloudAuthFailure(parent.id);
        return {
          ...result,
          success: false,
          needsReconnect: true,
          error: classified.message,
        };
      }
      console.error("[iCloud Sync] Kalender fejlede:", error);
      await db
        .update(calendarConnections)
        .set({ syncError: classified.message, updatedAt: now })
        .where(eq(calendarConnections.id, child.id));
      result.success = false;
      result.error = result.error ?? classified.message;
    }
  }

  await db
    .update(calendarConnections)
    .set({
      lastSynced: now,
      syncError: result.success ? null : (result.error ?? null),
      ...(result.success && {
        consecutiveSyncFailures: 0,
        syncDisabledUntil: null,
      }),
      updatedAt: now,
    })
    .where(eq(calendarConnections.id, parent.id));

  return result;
}

/** Nulstil ctag, så næste synk genanvender filtre/privatliv på alt */
export async function invalidateICloudSyncCache(userId: string) {
  await db
    .update(calendarConnections)
    .set({ syncToken: null, updatedAt: new Date() })
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, PROVIDER),
      ),
    );
}
