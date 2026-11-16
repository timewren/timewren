/**
 * Fælles lag over kalenderudbyderne (Google + iCloud/CalDAV).
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

/**
 * Forbindelser der bærer kalenderindstillinger. Google først (samme opslag
 * som hidtil), derefter iCloud-forælderen. Læsning bruger det første element.
 */
export async function findSettingsConnections(userId: string) {
  const google = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
    ),
  });
  const apple = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "apple"),
      isNull(calendarConnections.parentConnectionId),
    ),
  });
  return [google, apple].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
}

/**
 * Status til kalendersiden/widgets: Google hvis forbundet, ellers iCloud.
 */
export async function getAnyCalendarStatus(userId: string) {
  const google = await getCalendarConnectionStatus(userId);
  if (google.connected) {
    return { ...google, provider: "google" as const, needsReconnect: false };
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
 */
export async function syncAllCalendarProviders(userId: string) {
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

  const google = await syncCalendarEvents(userId);
  return {
    success: google.success && icloud.success,
    synced: (google.synced ?? 0) + icloud.synced,
    updated: (google.updated ?? 0) + icloud.updated,
    deleted: (google.deleted ?? 0) + icloud.deleted,
    filtered: (google.filtered ?? 0) + icloud.filtered,
    total: (google.total ?? 0) + icloud.total,
    incremental: google.incremental && icloud.incremental,
    error: google.error ?? icloud.error,
  };
}
