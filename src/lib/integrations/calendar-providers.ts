/**
 * Fælles lag over kalenderudbyderne (Google, Outlook og iCloud/CalDAV).
 *
 * Synk-filtre, privatlivstilstand og auto-track er brugerindstillinger, men
 * ligger fysisk på hver udbyders primære forbindelse. Helperne her holder
 * dem ens på tværs, så iCloud-hændelser indgår i de samme flows som Google.
 */

import { and, eq, isNull } from "drizzle-orm";
import { syncT } from "@/i18n/sync-text";
import { db } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import {
  getCalendarConnectionStatus,
  syncCalendarEvents,
} from "./google-calendar";
import { getICloudStatus, syncICloudCalendars } from "./icloud-calendar";
import {
  getOutlookStatus,
  OUTLOOK_PROVIDER,
  syncOutlookCalendar,
} from "./outlook-calendar";

/**
 * Forbindelser der bærer kalenderindstillinger. Google først (samme opslag
 * som hidtil), derefter Outlook og iCloud-forælderen. Læsning bruger det
 * første element.
 */
export async function findSettingsConnections(userId: string) {
  const google = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
    ),
  });
  const outlook = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, OUTLOOK_PROVIDER),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
  const apple = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "apple"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
  return [google, outlook, apple].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
}

/**
 * Status til kalendersiden/widgets: Google hvis forbundet, ellers Outlook,
 * ellers iCloud.
 */
export async function getAnyCalendarStatus(userId: string) {
  const google = await getCalendarConnectionStatus(userId);
  if (google.connected) {
    return { ...google, provider: "google" as const, needsReconnect: false };
  }
  const outlook = await getOutlookStatus(userId);
  if (outlook.connected) {
    return {
      connected: true,
      enabled: !outlook.needsReconnect,
      accountEmail: outlook.accountEmail,
      lastSynced: outlook.lastSynced,
      error: outlook.error,
      provider: "outlook" as const,
      needsReconnect: outlook.needsReconnect,
      // Outlook er altid read-only (Calendars.Read)
      accessLevel: null,
    };
  }
  const icloud = await getICloudStatus(userId);
  if (icloud.connected) {
    return {
      connected: true,
      enabled: !icloud.needsReconnect,
      accountEmail: icloud.appleId,
      lastSynced: icloud.lastSynced,
      error: icloud.error,
      provider: "apple" as const,
      needsReconnect: icloud.needsReconnect,
      // Google-adgangsniveau gælder ikke CalDAV (altid read-only)
      accessLevel: null,
    };
  }
  return { ...google, provider: null, needsReconnect: false };
}

/**
 * Manuel synk ("Synkroniser nu"): kør alle forbundne udbydere og saml
 * resultatet i samme form som Google-synken altid har returneret.
 * Uden Outlook-forbindelse præcis som før (Google + iCloud).
 */
export async function syncAllCalendarProviders(userId: string) {
  const outlookStatus = await getOutlookStatus(userId);
  if (!outlookStatus.connected) return syncGoogleAndICloud(userId);

  const outlook = await syncOutlookCalendar(userId, { force: true }).catch(
    (error: unknown) => {
      console.error("[Calendar Sync] Outlook fejlede:", error);
      return {
        success: false,
        synced: 0,
        updated: 0,
        deleted: 0,
        filtered: 0,
        total: 0,
        incremental: false,
        error: syncT("integrations.outlook.syncFailed"),
      };
    },
  );
  const [googleStatus, icloudStatus] = await Promise.all([
    getCalendarConnectionStatus(userId),
    getICloudStatus(userId),
  ]);
  if (!googleStatus.connected && !icloudStatus.connected) return outlook;

  return mergeSyncResults(outlook, await syncGoogleAndICloud(userId));
}

interface SyncCounts {
  success: boolean;
  synced?: number;
  updated?: number;
  deleted?: number;
  filtered?: number;
  total?: number;
  incremental?: boolean;
  error?: string;
}

/** Saml to udbyderes synk-resultater; første resultats fejl vinder. */
function mergeSyncResults(a: SyncCounts, b: SyncCounts) {
  return {
    success: a.success && b.success,
    synced: (a.synced ?? 0) + (b.synced ?? 0),
    updated: (a.updated ?? 0) + (b.updated ?? 0),
    deleted: (a.deleted ?? 0) + (b.deleted ?? 0),
    filtered: (a.filtered ?? 0) + (b.filtered ?? 0),
    total: (a.total ?? 0) + (b.total ?? 0),
    incremental: a.incremental && b.incremental,
    error: a.error ?? b.error,
  };
}

async function syncGoogleAndICloud(userId: string) {
  const [googleStatus, icloudStatus] = await Promise.all([
    getCalendarConnectionStatus(userId),
    getICloudStatus(userId),
  ]);

  if (!icloudStatus.connected) return syncCalendarEvents(userId);
  const icloud = await syncICloudCalendars(userId).catch((error: unknown) => {
    console.error("[Calendar Sync] iCloud fejlede:", error);
    return {
      success: false,
      synced: 0,
      updated: 0,
      deleted: 0,
      filtered: 0,
      total: 0,
      incremental: false,
      error: syncT("integrations.icloud.syncFailed"),
    };
  });
  if (!googleStatus.connected) return icloud;

  return mergeSyncResults(await syncCalendarEvents(userId), icloud);
}
