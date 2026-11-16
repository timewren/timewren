import type { NotificationChannelKey } from "../events";
import { emailChannel } from "./email";
import { inAppChannel } from "./inApp";
import { pushChannel } from "./push";
import { teamsChannel } from "./teams";
import type { NotificationChannel } from "./types";

/** Standard-registry — bussen kan få et andet sæt injiceret (tests). */
export const DEFAULT_CHANNELS: ReadonlyMap<
  NotificationChannelKey,
  NotificationChannel
> = new Map<NotificationChannelKey, NotificationChannel>([
  [inAppChannel.key, inAppChannel],
  [emailChannel.key, emailChannel],
  [pushChannel.key, pushChannel],
  [teamsChannel.key, teamsChannel],
]);
