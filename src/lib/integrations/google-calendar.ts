import crypto from "node:crypto";
import { calendar as createCalendar } from "@googleapis/calendar";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { syncT } from "@/i18n/sync-text";
import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import { passesFilters, type SyncFilters } from "@/lib/calendar/sync-filters";
import { getCallbackBaseUrl } from "@/lib/config";
import { db } from "@/lib/db";
import {
  calendarConnections,
  calendarEvents,
  members,
  tasks,
} from "@/lib/db/schema";
import { appUrlEnv } from "@/lib/runtime-env";
import { hashToken } from "@/lib/security/token-hash";
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenWallTime,
  dateAnchorFromStr,
  isoWeekdayOfDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import {
  decryptSecretOrNull,
  EncryptionKeyError,
  encryptSecret,
  encryptSecretOrNull,
} from "@/lib/utils/encryption";
import {
  getAuthScopes,
  getCalendarAccessLevel,
  normalizeGrantedScopes,
} from "./google-calendar-scopes";

// Google OAuth2 Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${appUrlEnv()}/api/integrations/google/callback`;

/**
 * Resolve org for a user from the members table.
 */
async function resolveUserOrgId(userId: string): Promise<string | null> {
  const membership = await db.query.members.findFirst({
    where: eq(members.userId, userId),
    columns: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/**
 * Check if Google Calendar integration is configured
 */
export function isGoogleCalendarConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/**
 * Kan en konto på `brand` forbinde Google Calendar? Klienten her er TimeTracks
 * (GOOGLE_CLIENT_ID, redirect til TimeTracks app-URL), så kun TimeTrack-konti.
 * TimeWren-konti ser "kommer snart", til TimeWren har sin egen Google-klient
 * og synkroniseringen kan vælge klient pr. forbindelse
 * (docs/specs/timewren-cloud.md → 5, "Login-udbydere").
 */
export function isGoogleCalendarAvailableForBrand(brand: BrandKey): boolean {
  return brand === DEFAULT_BRAND_KEY && isGoogleCalendarConfigured();
}

/**
 * Create OAuth2 client with timeout configuration
 */
export function createOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Calendar credentials not configured");
  }

  const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );

  // Set default timeout for all googleapis requests via this client
  oauth2Client.transporter.defaults = {
    ...oauth2Client.transporter.defaults,
    timeout: 15_000,
  };

  return oauth2Client;
}

/**
 * Generate authorization URL for OAuth2 flow.
 *
 * Default is read-only (calendar.readonly + userinfo.email). `write: true`
 * adds calendar.events via incremental authorization: include_granted_scopes
 * keeps previously granted scopes on the new token.
 */
export function getAuthorizationUrl(
  state?: string,
  options: { write?: boolean; loginHint?: string | null } = {},
): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: getAuthScopes({ write: options.write }),
    include_granted_scopes: true,
    prompt: "consent", // Force consent screen to get refresh token
    state,
    ...(options.loginHint && { login_hint: options.loginHint }),
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) {
    throw new Error("Failed to get access token");
  }

  // Get user info to identify the account
  oauth2Client.setCredentials(tokens);
  const userInfo = await oauth2Client.request<{ email?: string | null }>({
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountEmail: userInfo.data.email,
    grantedScopes: normalizeGrantedScopes(tokens.scope),
  };
}

/**
 * Get authenticated OAuth2 client for a user
 */
export async function getAuthenticatedClient(userId: string) {
  // Only primary connections hold OAuth tokens — children read from parent.
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      eq(calendarConnections.syncEnabled, true),
      isNull(calendarConnections.parentConnectionId),
    ),
  });

  if (!connection) {
    return null;
  }

  // Kan tokens ikke dekrypteres (manglende/ændret ENCRYPTION_KEY), kaster vi
  // med en tydelig fejl i stedet for at lade som om kalenderen ikke er
  // forbundet — og uden at slå brugerens sync fra.
  const tokens = readConnectionTokens(connection);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken || undefined,
    expiry_date: connection.tokenExpiry?.getTime(),
  });

  // Check if token needs refresh
  if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
    if (!tokens.refreshToken) {
      // Token expired and no refresh token - need to re-auth
      await db
        .update(calendarConnections)
        .set({
          syncEnabled: false,
          syncError: "Token expired. Please reconnect your calendar.",
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));
      return null;
    }

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      if (!credentials.access_token) {
        throw new Error("Google returned no access token on refresh");
      }
      oauth2Client.setCredentials(credentials);

      // Update stored tokens (krypteret at rest, #690)
      await db
        .update(calendarConnections)
        .set({
          accessToken: encryptSecret(credentials.access_token),
          tokenExpiry: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : null,
          grantedScopes:
            normalizeGrantedScopes(credentials.scope) ??
            connection.grantedScopes,
          syncError: null,
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));
    } catch (error) {
      console.error("Failed to refresh Google token:", error);
      // Manglende/ugyldig ENCRYPTION_KEY er en serverfejl — slå ikke brugerens
      // sync fra for den.
      if (error instanceof EncryptionKeyError) throw error;
      await db
        .update(calendarConnections)
        .set({
          syncEnabled: false,
          syncError: "Failed to refresh token. Please reconnect your calendar.",
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));
      return null;
    }
  }

  return { oauth2Client, connection };
}

/**
 * Dekryptér en forbindelses OAuth-tokens. Tåler klartekst-rækker fra før
 * kryptering (#690) indtil backfill har kørt.
 */
export function readConnectionTokens(connection: {
  accessToken: string | null;
  refreshToken: string | null;
}): { accessToken: string | null; refreshToken: string | null } {
  return {
    accessToken: decryptSecretOrNull(connection.accessToken),
    refreshToken: decryptSecretOrNull(connection.refreshToken),
  };
}

/**
 * Save or update calendar connection
 */
export async function saveCalendarConnection(
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken: string | null | undefined;
    tokenExpiry: Date | null;
    accountEmail: string | null | undefined;
    grantedScopes?: string | null;
  },
) {
  // Kryptér før vi rører databasen: mangler ENCRYPTION_KEY, fejler vi her og
  // gemmer aldrig tokens i klartekst (#690).
  const encryptedAccessToken = encryptSecret(tokens.accessToken);
  const encryptedRefreshToken = encryptSecretOrNull(tokens.refreshToken);

  // Check if primary connection already exists (only primary holds tokens)
  const existing = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });

  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        accessToken: encryptedAccessToken,
        // Google sender kun refresh-token ved første samtykke — behold den
        // gemte (allerede lagrede) værdi uændret når der ikke kommer en ny.
        refreshToken: encryptedRefreshToken ?? existing.refreshToken,
        tokenExpiry: tokens.tokenExpiry,
        providerAccountId: tokens.accountEmail || existing.providerAccountId,
        grantedScopes: tokens.grantedScopes ?? existing.grantedScopes,
        syncEnabled: true,
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));
    return existing.id;
  }

  const [newConnection] = await db
    .insert(calendarConnections)
    .values({
      userId,
      provider: "google",
      providerAccountId: tokens.accountEmail,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiry: tokens.tokenExpiry,
      grantedScopes: tokens.grantedScopes ?? null,
      calendarId: "primary",
      // Read-only connections can't write back; don't claim two-way sync.
      syncDirection:
        getCalendarAccessLevel(tokens.grantedScopes ?? null) === "read_write"
          ? "both"
          : "inbound",
      syncEnabled: true,
    })
    .returning({ id: calendarConnections.id });

  return newConnection.id;
}

/**
 * Disconnect Google Calendar
 */
export async function disconnectCalendar(userId: string) {
  // Delete all events for this user that came from Google — iCloud-
  // hændelser (andre forbindelser) skal blive stående
  const googleConnectionIds = (
    await db.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, "google"),
      ),
      columns: { id: true },
    })
  ).map((c) => c.id);
  await db
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.syncDirection, "inbound"),
        googleConnectionIds.length > 0
          ? or(
              isNull(calendarEvents.calendarConnectionId),
              inArray(calendarEvents.calendarConnectionId, googleConnectionIds),
            )
          : isNull(calendarEvents.calendarConnectionId),
      ),
    );

  // Delete the connection
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, "google"),
      ),
    );
}

/**
 * Get list of available calendars for a user
 */
export async function listCalendars(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return [];

  const calendar = createCalendar({ version: "v3", auth: auth.oauth2Client });

  try {
    const response = await calendar.calendarList.list();
    return (
      response.data.items?.map((cal) => ({
        id: cal.id,
        name: cal.summary,
        primary: cal.primary || false,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
      })) || []
    );
  } catch (error) {
    console.error("Failed to list calendars:", error);
    return [];
  }
}

/**
 * Get the user's response status for a Google Calendar event
 */
function getResponseStatus(event: {
  attendees?: { self?: boolean; responseStatus?: string }[];
}): string | null {
  if (!event.attendees) return null;
  const self = event.attendees.find((a) => a.self);
  return self?.responseStatus || null;
}

/**
 * Sync a single calendar connection's events from Google using incremental sync (syncToken).
 * First sync fetches all events, subsequent syncs only fetch changes.
 *
 * For child connections (parentConnectionId set), OAuth tokens are loaded from the parent connection.
 */
async function syncSingleConnection(
  userId: string,
  orgId: string | null,
  connection: {
    id: string;
    calendarId: string | null;
    syncToken: string | null;
    syncFilters: unknown;
    privacyMode: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiry: Date | null;
    parentConnectionId: string | null;
  },
  oauth2Client: OAuth2Client,
  options: {
    fullSync?: boolean;
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  } = {},
) {
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });
  const filters = (connection.syncFilters as SyncFilters) || null;
  const privacyMode = connection.privacyMode || "off";

  const useIncremental = !options.fullSync && !!connection.syncToken;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: Google calendar event items type
    let allEvents: any[] = [];
    let nextSyncToken: string | null | undefined = null;
    let pageToken: string | undefined;

    // Paginate through all results
    do {
      // biome-ignore lint/suspicious/noExplicitAny: Google API params differ between incremental/full
      const params: any = {
        calendarId: connection.calendarId || "primary",
        maxResults: 250,
        singleEvents: true,
      };

      if (useIncremental) {
        // Incremental sync — only changes since last sync
        params.syncToken = connection.syncToken;
      } else {
        // Full sync — fetch a time range
        const timeMin =
          options.timeMin || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const timeMax =
          options.timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        params.timeMin = timeMin.toISOString();
        params.timeMax = timeMax.toISOString();
        params.orderBy = "startTime";
      }

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await calendar.events.list(params);
      allEvents = allEvents.concat(response.data.items || []);
      pageToken = response.data.nextPageToken || undefined;
      nextSyncToken = response.data.nextSyncToken;
    } while (pageToken);

    let synced = 0;
    let updated = 0;
    let deleted = 0;
    let filtered = 0;

    // Process each event
    for (const event of allEvents) {
      if (!event.id) continue;

      // Check if event already exists
      const existing = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.externalId, event.id),
        ),
      });

      // Handle cancelled events
      if (event.status === "cancelled") {
        if (existing) {
          await db
            .update(calendarEvents)
            .set({ isCancelled: true, updatedAt: new Date() })
            .where(eq(calendarEvents.id, existing.id));
          deleted++;
        }
        continue;
      }

      // Skip events without title (unless already exists — update it)
      if (!event.summary && !existing) continue;

      // Apply sync filters
      if (!passesFilters(event, filters)) {
        filtered++;
        continue;
      }

      const isAllDay = !event.start?.dateTime;
      const startTime = event.start?.dateTime || event.start?.date;
      const endTime = event.end?.dateTime || event.end?.date;
      if (!startTime || !endTime) continue;

      // Apply privacy mode
      const title =
        privacyMode === "mask_titles"
          ? "Optaget"
          : event.summary || "Uden titel";

      const responseStatus = getResponseStatus(event);

      const eventData = {
        title,
        description:
          privacyMode === "mask_titles" ? null : event.description || null,
        location: privacyMode === "mask_titles" ? null : event.location || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        isAllDay,
        timezone: event.start?.timeZone || null,
        externalEtag: event.etag || null,
        responseStatus,
        lastSyncedAt: new Date(),
        isCancelled: false,
        updatedAt: new Date(),
      };

      if (existing) {
        // Update if etag changed
        if (existing.externalEtag !== event.etag) {
          await db
            .update(calendarEvents)
            .set(eventData)
            .where(eq(calendarEvents.id, existing.id));
          updated++;
        }
      } else {
        // Create new event
        await db.insert(calendarEvents).values({
          userId,
          organizationId: orgId,
          calendarConnectionId: connection.id,
          externalId: event.id,
          eventType: "external",
          syncDirection: "inbound",
          ...eventData,
        });
        synced++;
      }
    }

    // Update connection: last synced + store syncToken for incremental sync
    const connectionUpdate: Record<string, unknown> = {
      lastSynced: new Date(),
      syncError: null,
      updatedAt: new Date(),
    };
    if (nextSyncToken) {
      connectionUpdate.syncToken = nextSyncToken;
    }
    await db
      .update(calendarConnections)
      .set(connectionUpdate)
      .where(eq(calendarConnections.id, connection.id));

    return {
      success: true,
      synced,
      updated,
      deleted,
      filtered,
      total: allEvents.length,
      incremental: useIncremental,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // If syncToken is invalid (410 Gone), clear it and retry with full sync
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: number }).code === 410
    ) {
      console.warn(
        `[Calendar Sync] syncToken expired for connection ${connection.id}, falling back to full sync`,
      );
      await db
        .update(calendarConnections)
        .set({ syncToken: null, updatedAt: new Date() })
        .where(eq(calendarConnections.id, connection.id));

      // Retry with full sync
      return syncSingleConnection(userId, orgId, connection, oauth2Client, {
        ...options,
        fullSync: true,
      });
    }

    console.error("Calendar sync error:", error);

    await db
      .update(calendarConnections)
      .set({
        syncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connection.id));

    return { success: false, error: errorMessage };
  }
}

/**
 * Sync calendar events from Google using incremental sync (syncToken).
 * First sync fetches all events, subsequent syncs only fetch changes.
 *
 * If connectionId is provided, syncs only that connection.
 * Otherwise, syncs ALL connections for the user (primary + children).
 */
export async function syncCalendarEvents(
  userId: string,
  options: {
    fullSync?: boolean;
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
    connectionId?: string;
  } = {},
) {
  const syncError = (error: string) => ({
    success: false as const,
    error,
    synced: 0,
    updated: 0,
    deleted: 0,
    filtered: 0,
    total: 0,
    incremental: false,
  });

  const orgId = await resolveUserOrgId(userId);

  // If a specific connectionId is provided, sync only that one
  if (options.connectionId) {
    const targetConnection = await db.query.calendarConnections.findFirst({
      where: and(
        eq(calendarConnections.id, options.connectionId),
        eq(calendarConnections.userId, userId),
      ),
    });

    if (!targetConnection) {
      return syncError("Connection not found");
    }

    // Determine which connection holds OAuth tokens
    let tokenConnection = targetConnection;
    if (targetConnection.parentConnectionId) {
      const parent = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.id, targetConnection.parentConnectionId),
      });
      if (!parent) {
        return syncError("Parent connection not found");
      }
      tokenConnection = parent;
    }

    if (!tokenConnection.accessToken) {
      return syncError("No access token available");
    }

    let tokens: ReturnType<typeof readConnectionTokens>;
    try {
      tokens = readConnectionTokens(tokenConnection);
    } catch (error) {
      console.error("Failed to decrypt Google Calendar tokens:", error);
      return syncError(
        error instanceof Error ? error.message : "Token decryption failed",
      );
    }
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken || undefined,
      expiry_date: tokenConnection.tokenExpiry?.getTime(),
    });

    return syncSingleConnection(
      userId,
      orgId,
      targetConnection,
      oauth2Client,
      options,
    );
  }

  // No specific connectionId — sync all connections for this user
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return syncError("Not connected to Google Calendar");
  }

  const { oauth2Client, connection: primaryConnection } = auth;

  // Find child connections that share OAuth tokens with the primary
  const childConnections = await db.query.calendarConnections.findMany({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.parentConnectionId, primaryConnection.id),
      eq(calendarConnections.syncEnabled, true),
    ),
  });

  // Sync the primary connection first
  const primaryResult = await syncSingleConnection(
    userId,
    orgId,
    primaryConnection,
    oauth2Client,
    options,
  );

  // Aggregate results
  const results = {
    success: primaryResult.success,
    synced: primaryResult.synced || 0,
    updated: primaryResult.updated || 0,
    deleted: primaryResult.deleted || 0,
    filtered: primaryResult.filtered || 0,
    total: primaryResult.total || 0,
    incremental: primaryResult.incremental || false,
    calendarsSynced: 1,
    error: primaryResult.error,
  };

  // Sync each child connection using the same OAuth client
  for (const child of childConnections) {
    const childResult = await syncSingleConnection(
      userId,
      orgId,
      child,
      oauth2Client,
      options,
    );

    results.calendarsSynced++;
    results.synced += childResult.synced || 0;
    results.updated += childResult.updated || 0;
    results.deleted += childResult.deleted || 0;
    results.filtered += childResult.filtered || 0;
    results.total += childResult.total || 0;
    if (!childResult.success) {
      results.success = false;
      results.error = results.error || childResult.error;
    }
  }

  return results;
}

/**
 * Create a time block in Google Calendar for a task
 */
export async function createTimeBlock(
  userId: string,
  taskId: string,
  startTime: Date,
  endTime: Date,
) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return { success: false, error: "Not connected to Google Calendar" };
  }

  // Get the task, scoped to the caller's org/user (samme ownershipFilter-mønster som tasks-routeren)
  const timeBlockOrgId = await resolveUserOrgId(userId);
  const taskOwnershipFilter = timeBlockOrgId
    ? eq(tasks.organizationId, timeBlockOrgId)
    : eq(tasks.userId, userId);
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), taskOwnershipFilter),
    with: { project: true },
  });

  if (!task) {
    return { success: false, error: "Task not found" };
  }

  const { oauth2Client, connection } = auth;
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    // Normalize Drizzle relation types
    const taskProject = task.project
      ? Array.isArray(task.project)
        ? task.project[0]
        : task.project
      : null;
    const eventSummary = taskProject
      ? `[${taskProject.name}] ${task.title}`
      : task.title;

    const response = await calendar.events.insert({
      calendarId: connection.calendarId || "primary",
      requestBody: {
        summary: eventSummary,
        description: task.description || `TimeTrack Task: ${task.title}`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        colorId: "9", // Blue
      },
    });

    if (!response.data.id) {
      throw new Error("Failed to create calendar event");
    }

    // Create local event record
    const [localEvent] = await db
      .insert(calendarEvents)
      .values({
        userId,
        organizationId: timeBlockOrgId,
        calendarConnectionId: connection.id,
        externalId: response.data.id,
        title: eventSummary,
        description: task.description,
        startTime,
        endTime,
        eventType: "time_block",
        syncDirection: "outbound",
        linkedTaskId: taskId,
        linkedProjectId: task.projectId,
      })
      .returning();

    // Link task to calendar event
    await db
      .update(tasks)
      .set({
        calendarEventId: localEvent.id,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), taskOwnershipFilter));

    return {
      success: true,
      eventId: localEvent.id,
      googleEventId: response.data.id,
    };
  } catch (error) {
    console.error("Failed to create time block:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a time block from Google Calendar
 */
export async function deleteTimeBlock(userId: string, eventId: string) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return { success: false, error: "Not connected to Google Calendar" };
  }

  // Get the event
  const event = await db.query.calendarEvents.findFirst({
    where: and(
      eq(calendarEvents.id, eventId),
      eq(calendarEvents.userId, userId),
    ),
  });

  if (!event) {
    return { success: false, error: "Event not found" };
  }

  const { oauth2Client, connection } = auth;
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    if (event.externalId) {
      await calendar.events.delete({
        calendarId: connection.calendarId || "primary",
        eventId: event.externalId,
      });
    }

    // Remove link from task if exists
    if (event.linkedTaskId) {
      await db
        .update(tasks)
        .set({ calendarEventId: null, updatedAt: new Date() })
        .where(eq(tasks.id, event.linkedTaskId));
    }

    // Delete local event
    await db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));

    return { success: true };
  } catch (error) {
    console.error("Failed to delete time block:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get available time slots in calendar for a given day
 */
export async function getAvailableSlots(
  userId: string,
  date: Date,
  options: {
    workingHoursStart?: string; // HH:MM format
    workingHoursEnd?: string;
    slotDurationMinutes?: number;
  } = {},
) {
  const workStart = options.workingHoursStart || "09:00";
  const workEnd = options.workingHoursEnd || "17:00";
  const slotDuration = options.slotDurationMinutes || 60;

  // Den danske dag og arbejdstid uanset processens TZ (#734)
  const dayStr = toCopenhagenDateStr(date);
  const [year, month, day] = dayStr.split("-").map(Number);
  const startOfDay = copenhagenDayStart(dayStr);
  const endOfDay = new Date(copenhagenDayEndExclusive(dayStr).getTime() - 1);

  const events = await db.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.userId, userId),
      gte(calendarEvents.startTime, startOfDay),
      lte(calendarEvents.endTime, endOfDay),
      eq(calendarEvents.isCancelled, false),
    ),
    orderBy: (events, { asc }) => [asc(events.startTime)],
  });

  // Parse working hours
  const [startHour, startMinute] = workStart.split(":").map(Number);
  const [endHour, endMinute] = workEnd.split(":").map(Number);

  const workStartTime = copenhagenWallTime(
    year,
    month,
    day,
    startHour,
    startMinute,
  );
  const workEndTime = copenhagenWallTime(year, month, day, endHour, endMinute);

  // Find available slots
  const slots: Array<{ start: Date; end: Date; durationMinutes: number }> = [];

  let currentTime = workStartTime;

  for (const event of events) {
    // Skip if event starts after working hours
    if (event.startTime >= workEndTime) continue;
    // Skip if event ends before working hours
    if (event.endTime <= workStartTime) continue;

    // Available slot before this event
    if (currentTime < event.startTime) {
      const slotEnd =
        event.startTime < workEndTime ? event.startTime : workEndTime;
      const duration =
        (slotEnd.getTime() - currentTime.getTime()) / (1000 * 60);

      if (duration >= slotDuration) {
        slots.push({
          start: new Date(currentTime),
          end: slotEnd,
          durationMinutes: duration,
        });
      }
    }

    // Move current time to after this event
    if (event.endTime > currentTime) {
      currentTime = new Date(event.endTime);
    }
  }

  // Check for remaining time after all events
  if (currentTime < workEndTime) {
    const duration =
      (workEndTime.getTime() - currentTime.getTime()) / (1000 * 60);
    if (duration >= slotDuration) {
      slots.push({
        start: new Date(currentTime),
        end: workEndTime,
        durationMinutes: duration,
      });
    }
  }

  return slots;
}

/**
 * Suggest time blocks for tasks based on available slots and priorities
 */
export async function suggestTimeBlocks(
  userId: string,
  options: {
    startDate?: Date;
    daysToSchedule?: number;
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: number[]; // 0 = Sunday, 1 = Monday, etc.
  } = {},
) {
  const startDate = options.startDate || new Date();
  const daysToSchedule = options.daysToSchedule || 7;
  const workingDays = options.workingDays || [1, 2, 3, 4, 5]; // Monday to Friday

  // Get unscheduled tasks with priorities
  const unscheduledTasks = await db.query.tasks.findMany({
    where: and(
      eq(tasks.userId, userId),
      or(eq(tasks.status, "todo"), eq(tasks.status, "backlog")),
      isNull(tasks.calendarEventId),
    ),
    orderBy: (tasks, { asc, desc }) => [
      // Urgent first, then by deadline
      desc(tasks.priority),
      asc(tasks.deadline),
    ],
    with: { project: true },
  });

  const suggestions: Array<{
    task: (typeof unscheduledTasks)[0];
    suggestedSlot: { start: Date; end: Date };
    reason: string;
  }> = [];

  // For each day, try to schedule tasks
  for (let dayOffset = 0; dayOffset < daysToSchedule; dayOffset++) {
    // Danske kalenderdage uanset processens TZ og sommertid (#734)
    const dayStr = addDaysToDateStr(toCopenhagenDateStr(startDate), dayOffset);
    const scheduleDate = dateAnchorFromStr(dayStr);

    // Skip non-working days (0 = søndag)
    const weekday = isoWeekdayOfDateStr(dayStr) % 7;
    if (!workingDays.includes(weekday)) continue;

    const availableSlots = await getAvailableSlots(userId, scheduleDate, {
      workingHoursStart: options.workingHoursStart,
      workingHoursEnd: options.workingHoursEnd,
    });

    for (const slot of availableSlots) {
      // Find a task that fits this slot
      for (const task of unscheduledTasks) {
        // Skip if already suggested
        if (suggestions.some((s) => s.task.id === task.id)) continue;

        const taskDuration = task.estimatedMinutes || 60; // Default 1 hour

        if (slot.durationMinutes >= taskDuration) {
          const suggestedEnd = new Date(
            slot.start.getTime() + taskDuration * 60 * 1000,
          );

          let reason = syncT("integrations.google.freeSlot");
          if (task.deadline) {
            const daysUntilDeadline = Math.ceil(
              (task.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            );
            if (daysUntilDeadline <= 3) {
              reason = syncT("integrations.google.deadlineIn", {
                count: daysUntilDeadline,
              });
            }
          }
          if (task.priority === "urgent") {
            reason = syncT("integrations.google.urgent");
          } else if (task.priority === "high") {
            reason = syncT("integrations.google.high");
          }

          suggestions.push({
            task,
            suggestedSlot: {
              start: slot.start,
              end: suggestedEnd,
            },
            reason,
          });

          // Reduce available time in this slot
          slot.start = suggestedEnd;
          slot.durationMinutes -= taskDuration;

          break;
        }
      }
    }
  }

  return suggestions;
}

/**
 * Get calendar connection status for a user
 */
export async function getCalendarConnectionStatus(userId: string) {
  // Primary connection only — it holds the tokens and thus the granted scopes.
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });

  if (!connection) {
    return {
      connected: false,
      enabled: false,
      accountEmail: null,
      lastSynced: null,
      error: null,
      accessLevel: null,
    };
  }

  return {
    connected: true,
    enabled: connection.syncEnabled,
    accountEmail: connection.providerAccountId,
    calendarId: connection.calendarId,
    calendarName: connection.calendarName,
    lastSynced: connection.lastSynced,
    error: connection.syncError,
    accessLevel: getCalendarAccessLevel(connection.grantedScopes),
  };
}

// ============================================
// Time Entry Export to Calendar
// ============================================

// Project color mapping for Google Calendar (1-11)
const PROJECT_COLORS: Record<number, string> = {
  0: "1", // Lavender
  1: "2", // Sage
  2: "3", // Grape
  3: "4", // Flamingo
  4: "5", // Banana
  5: "6", // Tangerine
  6: "7", // Peacock
  7: "8", // Graphite
  8: "9", // Blueberry
  9: "10", // Basil
  10: "11", // Tomato
};

/**
 * Get a consistent color for a project based on its ID
 */
function getProjectColor(projectId: string | null): string {
  if (!projectId) return "9"; // Default: Blueberry

  // Hash the project ID to get a consistent color
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash << 5) - hash + projectId.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  const colorIndex = Math.abs(hash) % 11;
  return PROJECT_COLORS[colorIndex] || "9";
}

interface TimeEntryForExport {
  id: string;
  date: Date;
  hours: string;
  description: string | null;
  startTime: Date | null;
  endTime: Date | null;
  projectId: string | null;
  project?: {
    id: string;
    name: string;
    client?: {
      name: string;
    } | null;
  } | null;
  client?: {
    name: string;
  } | null;
}

/**
 * Export a time entry to Google Calendar as an event
 */
export async function exportTimeEntryToCalendar(
  userId: string,
  entry: TimeEntryForExport,
): Promise<{
  success: boolean;
  eventId?: string;
  googleEventId?: string;
  error?: string;
}> {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return { success: false, error: "Not connected to Google Calendar" };
  }

  const { oauth2Client, connection } = auth;
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    // Build event title
    const projectName = entry.project?.name;
    const clientName = entry.client?.name || entry.project?.client?.name;
    let title = entry.description || "Tidsregistrering";
    if (projectName) {
      title = `[${projectName}] ${title}`;
    }

    // Determine start and end times
    let startTime: Date;
    let endTime: Date;

    if (entry.startTime && entry.endTime) {
      // Use actual start/end times if available
      startTime = new Date(entry.startTime);
      endTime = new Date(entry.endTime);
    } else {
      // Calculate from hours (assume 9 AM start)
      const hours = parseFloat(entry.hours);
      startTime = new Date(entry.date);
      startTime.setHours(9, 0, 0, 0);
      endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + Math.round(hours * 60));
    }

    // Build description
    const descriptionParts = [];
    if (entry.description) descriptionParts.push(entry.description);
    if (clientName)
      descriptionParts.push(
        syncT("integrations.google.clientLine", { name: clientName }),
      );
    if (projectName)
      descriptionParts.push(
        syncT("integrations.google.projectLine", { name: projectName }),
      );
    descriptionParts.push(
      syncT("integrations.google.hoursLine", { hours: entry.hours }),
    );
    descriptionParts.push("---");
    descriptionParts.push(syncT("integrations.google.exportedFrom"));

    const response = await calendar.events.insert({
      calendarId: connection.calendarId || "primary",
      requestBody: {
        summary: title,
        description: descriptionParts.join("\n"),
        start: {
          dateTime: startTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        colorId: getProjectColor(entry.projectId),
        extendedProperties: {
          private: {
            timetrackEntryId: entry.id,
            timetrackProjectId: entry.projectId || "",
            source: "timetrack",
          },
        },
      },
    });

    if (!response.data.id) {
      throw new Error("Failed to create calendar event");
    }

    // Create local event record
    const exportOrgId = await resolveUserOrgId(userId);
    const [localEvent] = await db
      .insert(calendarEvents)
      .values({
        userId,
        organizationId: exportOrgId,
        calendarConnectionId: connection.id,
        externalId: response.data.id,
        title,
        description: descriptionParts.join("\n"),
        startTime,
        endTime,
        eventType: "time_entry",
        syncDirection: "outbound",
        linkedProjectId: entry.projectId,
      })
      .returning();

    return {
      success: true,
      eventId: localEvent.id,
      googleEventId: response.data.id,
    };
  } catch (error) {
    console.error("Failed to export time entry to calendar:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Bulk export multiple time entries to Google Calendar
 */
export async function bulkExportTimeEntriesToCalendar(
  userId: string,
  entries: TimeEntryForExport[],
): Promise<{
  success: boolean;
  exported: number;
  failed: number;
  errors: string[];
}> {
  const results = {
    success: true,
    exported: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const entry of entries) {
    const result = await exportTimeEntryToCalendar(userId, entry);
    if (result.success) {
      results.exported++;
    } else {
      results.failed++;
      if (result.error) {
        results.errors.push(`Entry ${entry.id}: ${result.error}`);
      }
    }

    // Rate limiting: wait a bit between API calls
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  results.success = results.failed === 0;
  return results;
}

/**
 * Update an existing calendar event from a time entry
 */
export async function updateCalendarEventFromTimeEntry(
  userId: string,
  googleEventId: string,
  entry: TimeEntryForExport,
): Promise<{ success: boolean; error?: string }> {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return { success: false, error: "Not connected to Google Calendar" };
  }

  const { oauth2Client, connection } = auth;
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    // Build event title
    const projectName = entry.project?.name;
    const clientName = entry.client?.name || entry.project?.client?.name;
    let title = entry.description || "Tidsregistrering";
    if (projectName) {
      title = `[${projectName}] ${title}`;
    }

    // Determine start and end times
    let startTime: Date;
    let endTime: Date;

    if (entry.startTime && entry.endTime) {
      startTime = new Date(entry.startTime);
      endTime = new Date(entry.endTime);
    } else {
      const hours = parseFloat(entry.hours);
      startTime = new Date(entry.date);
      startTime.setHours(9, 0, 0, 0);
      endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + Math.round(hours * 60));
    }

    // Build description
    const descriptionParts = [];
    if (entry.description) descriptionParts.push(entry.description);
    if (clientName)
      descriptionParts.push(
        syncT("integrations.google.clientLine", { name: clientName }),
      );
    if (projectName)
      descriptionParts.push(
        syncT("integrations.google.projectLine", { name: projectName }),
      );
    descriptionParts.push(
      syncT("integrations.google.hoursLine", { hours: entry.hours }),
    );
    descriptionParts.push("---");
    descriptionParts.push(syncT("integrations.google.exportedFrom"));

    await calendar.events.update({
      calendarId: connection.calendarId || "primary",
      eventId: googleEventId,
      requestBody: {
        summary: title,
        description: descriptionParts.join("\n"),
        start: {
          dateTime: startTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
        colorId: getProjectColor(entry.projectId),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to update calendar event:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a calendar event that was created from a time entry
 */
export async function deleteTimeEntryCalendarEvent(
  userId: string,
  googleEventId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) {
    return { success: false, error: "Not connected to Google Calendar" };
  }

  const { oauth2Client, connection } = auth;
  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    await calendar.events.delete({
      calendarId: connection.calendarId || "primary",
      eventId: googleEventId,
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to delete calendar event:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Register a webhook channel for push notifications.
 * The channel expires after 7 days and must be renewed.
 */
export async function registerWebhookChannel(
  userId: string,
): Promise<{ success: boolean; expiration?: string; error?: string }> {
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
  if (!connection?.accessToken) {
    return { success: false, error: "Not connected" };
  }

  let tokens: ReturnType<typeof readConnectionTokens>;
  try {
    tokens = readConnectionTokens(connection);
  } catch (error) {
    console.error("Failed to decrypt Google Calendar tokens:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Token decryption failed",
    };
  }
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  const calendar = createCalendar({ version: "v3", auth: oauth2Client });
  const webhookUrl = `${getCallbackBaseUrl()}/api/webhooks/google-calendar`;
  const channelId = `tt-cal-${connection.id}`;

  // Generate a per-channel random token. Google echoes this back in
  // X-Goog-Channel-Token on every notification; the webhook verifies
  // it matches the token stored on this connection. A leak of one
  // user's token doesn't compromise other users' channels.
  const webhookToken = crypto.randomBytes(24).toString("base64url");

  // Persist the token BEFORE calling Google's watch API so there is no
  // window where Google delivers notifications with a token the DB
  // hasn't seen yet. If watch fails, the token is orphaned but harmless
  // (Google never knows it, so no notification will ever carry it).
  // Next renewal simply overwrites.
  await db
    .update(calendarConnections)
    // Kun hashen gemmes (#713); Google får klarteksten i watch-kaldet.
    .set({
      webhookTokenHash: hashToken(webhookToken),
      webhookChannelId: channelId,
    })
    .where(eq(calendarConnections.id, connection.id));

  try {
    const res = await calendar.events.watch({
      calendarId: connection.calendarId || "primary",
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: webhookToken,
        // Expire in 7 days (maximum allowed by Google)
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Persist the expiry returned by Google.
    await db
      .update(calendarConnections)
      .set({
        webhookExpiry: res.data.expiration
          ? new Date(Number(res.data.expiration))
          : null,
      })
      .where(eq(calendarConnections.id, connection.id));

    return {
      success: true,
      expiration: res.data.expiration || undefined,
    };
  } catch (error) {
    console.error("Failed to register webhook channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Stop an active webhook channel.
 */
export async function stopWebhookChannel(
  userId: string,
  channelId: string,
  resourceId: string,
): Promise<{ success: boolean }> {
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
  if (!connection?.accessToken) return { success: false };

  // Best effort: en token der ikke kan dekrypteres må ikke blokere frakobling.
  let tokens: ReturnType<typeof readConnectionTokens>;
  try {
    tokens = readConnectionTokens(connection);
  } catch (error) {
    console.error("Failed to read Google tokens for channel stop:", error);
    return { success: false };
  }
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  const calendar = createCalendar({ version: "v3", auth: oauth2Client });

  try {
    await calendar.channels.stop({
      requestBody: { id: channelId, resourceId },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
