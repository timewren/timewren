/**
 * Notifikationsbus (E10, #468).
 *
 *   notify({ orgId, event, payload, userIds }) →
 *     præferencer (org-defaults ⊕ bruger) → fan-out til in_app/email/push
 *     pr. modtager + Teams én gang pr. hændelse (kun leder-hændelser).
 *
 * Kaster ALDRIG: forretningsflowet (indsend, godkend, registrér) må ikke
 * vælte på en notifikation. Hver leverance logges i notification_deliveries;
 * transiente fejl prøves igen én gang. Fejl i én kanal stopper ikke de andre.
 */

import { DEFAULT_CHANNELS } from "./channels/registry";
import {
  ChannelSkipped,
  type NotificationChannel,
  type OutgoingNotification,
} from "./channels/types";
import {
  type NotificationChannelKey,
  type NotificationEvent,
  type NotificationPayloads,
  type RenderedNotification,
  renderNotification,
} from "./events";
import { resolveUserChannels, teamsWanted } from "./preferences";
import { type BusStore, type DeliveryRecord, dbBusStore } from "./store";

export interface NotifyInput<E extends NotificationEvent> {
  orgId: string;
  event: E;
  payload: NotificationPayloads[E];
  /** Modtagere (bruger-id'er). Tom liste = kun org-kanaler (Teams). */
  userIds: string[];
  /** Udelad fx aktøren selv */
  excludeUserId?: string | null;
  /** Spring org-kanaler (Teams) over — fx når samme hændelse sendes pr. leder */
  skipOrgChannels?: boolean;
}

export interface NotifyResult {
  deliveries: DeliveryRecord[];
  sent: number;
  failed: number;
  skipped: number;
}

export interface BusDeps {
  store: BusStore;
  channels: ReadonlyMap<NotificationChannelKey, NotificationChannel>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string, error?: unknown) => void;
}

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;

function defaultIsTransient(error: unknown): boolean {
  const m = error instanceof Error ? error.message : String(error);
  return /ECONN|ETIMEDOUT|fetch failed|timeout|429|5\d\d/i.test(m);
}

async function deliver(
  channel: NotificationChannel,
  msg: OutgoingNotification,
  deps: BusDeps,
): Promise<DeliveryRecord> {
  const base = {
    organizationId: msg.orgId,
    userId: msg.recipient?.userId ?? null,
    event: msg.event,
    channel: channel.key,
    payload: { title: msg.rendered.title },
  };
  let attempts = 0;
  let lastError: unknown = null;
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      await channel.send(msg);
      return {
        ...base,
        status: "sent",
        attempts,
        error: null,
        sentAt: new Date(),
      };
    } catch (error) {
      if (error instanceof ChannelSkipped) {
        return {
          ...base,
          status: "skipped",
          attempts,
          error: error.message,
          sentAt: null,
        };
      }
      lastError = error;
      const transient = channel.isTransient
        ? channel.isTransient(error)
        : defaultIsTransient(error);
      if (!transient || attempts >= MAX_ATTEMPTS) break;
      await deps.sleep(RETRY_DELAY_MS);
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  deps.log(
    `[notification-bus] ${channel.key} fejlede for ${msg.event}${msg.recipient ? ` → ${msg.recipient.userId}` : ""}: ${message}`,
    lastError,
  );
  return {
    ...base,
    status: "failed",
    attempts,
    error: message.slice(0, 1000),
    sentAt: null,
  };
}

export function createNotificationBus(deps: BusDeps) {
  async function notify<E extends NotificationEvent>(
    input: NotifyInput<E>,
  ): Promise<NotifyResult> {
    const empty: NotifyResult = {
      deliveries: [],
      sent: 0,
      failed: 0,
      skipped: 0,
    };
    try {
      const org = await deps.store.loadOrg(input.orgId);
      if (!org) return empty;

      const userIds = Array.from(
        new Set(input.userIds.filter((id) => id !== input.excludeUserId)),
      );
      const [recipients, prefs] = await Promise.all([
        deps.store.loadRecipients(userIds),
        deps.store.loadUserPreferences(input.orgId, userIds),
      ]);

      // Org-kanalen (Teams) har ingen enkelt modtager: dansk. Bruger-kanaler
      // renderes i hver modtagers eget sprog.
      const rendered = renderNotification(input.event, input.payload);
      const baseMsg = {
        orgId: input.orgId,
        orgName: org.orgName,
        event: input.event,
        payload: input.payload,
        rendered,
      };

      const renderedByLocale = new Map<string, RenderedNotification>();
      const renderedFor = (locale?: string | null) => {
        const key = locale ?? "da";
        let r = renderedByLocale.get(key);
        if (!r) {
          r = renderNotification(input.event, input.payload, key);
          renderedByLocale.set(key, r);
        }
        return r;
      };

      const jobs: Promise<DeliveryRecord>[] = [];
      for (const recipient of recipients) {
        const channels = resolveUserChannels({
          event: input.event,
          orgDefaults: org.channelDefaults,
          userPrefs: prefs.get(recipient.userId) ?? null,
        });
        for (const key of channels) {
          const channel = deps.channels.get(key);
          if (channel?.scope !== "user") continue;
          jobs.push(
            deliver(
              channel,
              {
                ...baseMsg,
                rendered: renderedFor(recipient.locale),
                recipient,
              },
              deps,
            ),
          );
        }
      }

      if (
        !input.skipOrgChannels &&
        teamsWanted({
          event: input.event,
          orgDefaults: org.channelDefaults,
          teamsEnabled: org.teamsEnabled,
        })
      ) {
        const teams = deps.channels.get("teams");
        if (teams) {
          jobs.push(
            deliver(
              teams,
              { ...baseMsg, teamsWebhookUrl: org.teamsWebhookUrl },
              deps,
            ),
          );
        }
      }

      const settled = await Promise.allSettled(jobs);
      const deliveries: DeliveryRecord[] = settled.map((s) =>
        s.status === "fulfilled"
          ? s.value
          : {
              organizationId: input.orgId,
              userId: null,
              event: input.event,
              channel: "unknown",
              status: "failed" as const,
              attempts: 1,
              error: String(s.reason).slice(0, 1000),
              payload: null,
              sentAt: null,
            },
      );

      try {
        await deps.store.logDeliveries(deliveries);
      } catch (error) {
        deps.log("[notification-bus] Kunne ikke logge leverancer", error);
      }

      return {
        deliveries,
        sent: deliveries.filter((d) => d.status === "sent").length,
        failed: deliveries.filter((d) => d.status === "failed").length,
        skipped: deliveries.filter((d) => d.status === "skipped").length,
      };
    } catch (error) {
      deps.log(`[notification-bus] notify(${input.event}) fejlede`, error);
      return { ...empty, failed: 1 };
    }
  }

  return { notify };
}

const defaultBus = createNotificationBus({
  store: dbBusStore,
  channels: DEFAULT_CHANNELS,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (message, error) => console.error(message, error ?? ""),
});

/** Standard-bussen mod den rigtige DB og de rigtige kanaler. */
export const notify = defaultBus.notify;
