/**
 * Præference-opslag (ren, testbar): indbyggede defaults ⊕ org-defaults ⊕
 * bruger-overrides → sæt af kanaler for en hændelse.
 *
 * De indbyggede defaults ligger tæt på adfærden FØR bussen (e-mail på alt,
 * push i fraværsgruppen) men er IKKE identiske: push gælder nu hele
 * fraværsgruppen (også anmodning/sygemelding til leder), in_app er nyt, og
 * de nye hændelser (genåbnet, sygemelding, compliance, digest) følger deres
 * gruppe. Teams styres KUN på org-niveau (kanalen tilhører org'en, ikke
 * brugeren), kræver en webhook og er som udgangspunkt slået FRA for fravær —
 * sygemeldinger med navn i en kanal skal være en aktiv org-beslutning.
 */

import type { NotificationChannelMatrix } from "@/lib/db/schema";
import {
  eventAudience,
  eventGroup,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  type NotificationChannelKey,
  type NotificationEvent,
  type NotificationGroup,
} from "./events";

export type ChannelMatrix = Record<
  NotificationGroup,
  Record<NotificationChannelKey, boolean>
>;

export const BUILT_IN_DEFAULTS: ChannelMatrix = {
  timesheet: { in_app: true, email: true, push: false, teams: true },
  absence: { in_app: true, email: true, push: true, teams: false },
  reminder: { in_app: true, email: true, push: false, teams: false },
  compliance: { in_app: true, email: true, push: false, teams: true },
  digest: { in_app: false, email: true, push: false, teams: true },
};

/** Kanaler brugeren selv kan styre (Teams er org-ejet). */
export const USER_CHANNELS: readonly NotificationChannelKey[] = [
  "in_app",
  "email",
  "push",
];

/** Flet lag: senere lag overskriver kun de kanaler de nævner. */
export function mergeMatrix(
  ...layers: Array<NotificationChannelMatrix | null | undefined>
): ChannelMatrix {
  const out = structuredClone(BUILT_IN_DEFAULTS);
  for (const layer of layers) {
    if (!layer) continue;
    for (const group of NOTIFICATION_GROUPS) {
      const row = layer[group];
      if (!row) continue;
      for (const channel of NOTIFICATION_CHANNELS) {
        const v = row[channel];
        if (typeof v === "boolean") out[group][channel] = v;
      }
    }
  }
  return out;
}

/** Effektiv matrix for én bruger: defaults ⊕ org ⊕ bruger (bruger uden Teams). */
export function effectiveUserMatrix(
  orgDefaults: NotificationChannelMatrix | null | undefined,
  userPrefs: NotificationChannelMatrix | null | undefined,
): ChannelMatrix {
  return mergeMatrix(orgDefaults, sanitizeMatrix(userPrefs, USER_CHANNELS));
}

/**
 * Bruger-kanaler for hændelsen (in_app/email/push). Teams afgøres separat
 * med `teamsWanted`, da den sendes én gang pr. hændelse — ikke pr. modtager.
 */
export function resolveUserChannels(input: {
  event: NotificationEvent;
  orgDefaults?: NotificationChannelMatrix | null;
  userPrefs?: NotificationChannelMatrix | null;
}): NotificationChannelKey[] {
  const matrix = effectiveUserMatrix(input.orgDefaults, input.userPrefs);
  const row = matrix[eventGroup(input.event)];
  return USER_CHANNELS.filter((c) => row[c]);
}

/** Skal hændelsen til org'ens Teams-kanal? Kun leder-hændelser. */
export function teamsWanted(input: {
  event: NotificationEvent;
  orgDefaults?: NotificationChannelMatrix | null;
  teamsEnabled: boolean;
}): boolean {
  if (!input.teamsEnabled) return false;
  if (eventAudience(input.event) !== "manager") return false;
  return mergeMatrix(input.orgDefaults)[eventGroup(input.event)].teams;
}

/** Sanering af rå input: behold kun kendte grupper/kanaler med boolean-værdi. */
export function sanitizeMatrix(
  raw: unknown,
  allowedChannels: readonly NotificationChannelKey[] = NOTIFICATION_CHANNELS,
): NotificationChannelMatrix {
  const out: NotificationChannelMatrix = {};
  if (!raw || typeof raw !== "object") return out;
  for (const group of NOTIFICATION_GROUPS) {
    const row = (raw as Record<string, unknown>)[group];
    if (!row || typeof row !== "object") continue;
    const cleaned: Partial<Record<NotificationChannelKey, boolean>> = {};
    for (const channel of allowedChannels) {
      const v = (row as Record<string, unknown>)[channel];
      if (typeof v === "boolean") cleaned[channel] = v;
    }
    if (Object.keys(cleaned).length > 0) out[group] = cleaned;
  }
  return out;
}
