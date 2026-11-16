/**
 * DB-adgang for bussen bag et lille interface, så routing-logikken kan
 * testes med en in-memory-store.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  type NotificationChannelMatrix,
  notificationDeliveries,
  organizations,
  orgNotificationSettings,
  userNotificationPreferences,
  users,
} from "@/lib/db/schema";
import { getTeamsWebhookUrl } from "../webhook-secrets";
import type { NotificationRecipient } from "./channels/types";

export interface OrgNotificationContext {
  orgName: string;
  channelDefaults: NotificationChannelMatrix | null;
  teamsEnabled: boolean;
  teamsWebhookUrl: string | null;
}

export interface DeliveryRecord {
  organizationId: string;
  userId: string | null;
  event: string;
  channel: string;
  status: "sent" | "failed" | "skipped";
  attempts: number;
  error: string | null;
  payload: Record<string, unknown> | null;
  sentAt: Date | null;
}

export interface BusStore {
  loadOrg(orgId: string): Promise<OrgNotificationContext | null>;
  loadRecipients(userIds: string[]): Promise<NotificationRecipient[]>;
  loadUserPreferences(
    orgId: string,
    userIds: string[],
  ): Promise<Map<string, NotificationChannelMatrix>>;
  logDeliveries(rows: DeliveryRecord[]): Promise<void>;
}

export const dbBusStore: BusStore = {
  async loadOrg(orgId) {
    const [org, settings] = await Promise.all([
      db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { name: true },
      }),
      db.query.orgNotificationSettings.findFirst({
        where: eq(orgNotificationSettings.organizationId, orgId),
        columns: {
          channelDefaults: true,
          teamsEnabled: true,
          teamsWebhookUrl: true,
        },
      }),
    ]);
    if (!org) return null;
    const teamsWebhookUrl = getTeamsWebhookUrl(settings);
    return {
      orgName: org.name,
      channelDefaults: settings?.channelDefaults ?? null,
      teamsEnabled: Boolean(settings?.teamsEnabled && teamsWebhookUrl),
      teamsWebhookUrl,
    };
  },
  async loadRecipients(userIds) {
    if (userIds.length === 0) return [];
    const rows = await db.query.users.findMany({
      where: inArray(users.id, userIds),
      columns: { id: true, name: true, email: true, locale: true },
    });
    return rows.map((u) => ({
      userId: u.id,
      name: u.name ?? "",
      email: u.email ?? null,
      locale: u.locale ?? null,
    }));
  },
  async loadUserPreferences(orgId, userIds) {
    if (userIds.length === 0) return new Map();
    const rows = await db.query.userNotificationPreferences.findMany({
      where: and(
        eq(userNotificationPreferences.organizationId, orgId),
        inArray(userNotificationPreferences.userId, userIds),
      ),
      columns: { userId: true, preferences: true },
    });
    return new Map(rows.map((r) => [r.userId, r.preferences]));
  },
  async logDeliveries(rows) {
    if (rows.length === 0) return;
    await db.insert(notificationDeliveries).values(rows);
  },
};
