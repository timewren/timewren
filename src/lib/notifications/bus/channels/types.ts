import type {
  NotificationChannelKey,
  NotificationEvent,
  NotificationPayloads,
  RenderedNotification,
} from "../events";

export interface NotificationRecipient {
  userId: string;
  name: string;
  email: string | null;
  /** Modtagerens sprog (users.locale); udeladt = dansk */
  locale?: string | null;
}

export interface OutgoingNotification<
  E extends NotificationEvent = NotificationEvent,
> {
  orgId: string;
  orgName: string;
  event: E;
  payload: NotificationPayloads[E];
  rendered: RenderedNotification;
  /** Sat for bruger-kanaler; udeladt for org-kanaler (Teams) */
  recipient?: NotificationRecipient;
  /** Kun for Teams-kanalen */
  teamsWebhookUrl?: string | null;
}

/**
 * Pluggable kanal. `send` kaster ved fejl — bussen logger og afgør retry ud
 * fra `isTransient`. Kast `ChannelSkipped` når der intet er at levere (fx
 * ingen e-mail-adresse) — logges som skipped, ikke failed.
 */
export interface NotificationChannel {
  key: NotificationChannelKey;
  scope: "user" | "org";
  send(msg: OutgoingNotification): Promise<void>;
  isTransient?(error: unknown): boolean;
}

export class ChannelSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ChannelSkipped";
  }
}
