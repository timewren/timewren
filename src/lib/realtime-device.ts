/**
 * Hændelser på token-strømmen `/api/ext/stream` (desktop, udvidelse, mobil).
 *
 * Bygger på samme Valkey-kanaler som web's `/api/realtime`, men sender kun
 * hvad og hvilken version — aldrig forretningsdata (beskrivelser, kunde-
 * eller projekt-id'er, navne). Klienten henter selv det ændrede via API'et.
 * Ren modul uden server-imports, så mappingen kan unit-testes.
 */

/** Områder en token-klient kan genindlæse. */
export type DeviceEntity =
  | "timer"
  | "entries"
  | "clients"
  | "projects"
  | "klippekort"
  | "invoices"
  | "tasks"
  | "rules";

export type DeviceStreamEvent =
  | {
      type: "timer";
      /** sync | stopping | stopped | cleared (som web's timer-events) */
      event: string;
      version: number;
    }
  | { type: "data"; entities: DeviceEntity[] };

/** tRPC-domæne (router eller "router.procedure") → område for klienten. */
const DOMAIN_ENTITIES: Readonly<Record<string, DeviceEntity>> = {
  time: "entries",
  prepaid: "klippekort",
  clients: "clients",
  projects: "projects",
  invoices: "invoices",
  tasks: "tasks",
  // Matchningsregler (ext/rules.ts) — domænet er en fuld sti, ikke en router.
  "extension.rules": "rules",
};

const ENTITY_ORDER: readonly DeviceEntity[] = [
  "timer",
  "entries",
  "clients",
  "projects",
  "klippekort",
  "invoices",
  "tasks",
  "rules",
];

export function entitiesForDomains(
  domains: readonly unknown[],
): DeviceEntity[] {
  const found = new Set<DeviceEntity>();
  for (const domain of domains) {
    if (typeof domain !== "string") continue;
    const entity =
      DOMAIN_ENTITIES[domain] ?? DOMAIN_ENTITIES[domain.split(".")[0] ?? ""];
    if (entity) found.add(entity);
  }
  return ENTITY_ORDER.filter((e) => found.has(e));
}

/**
 * Valkey-besked → strøm-hændelse, eller null hvis klienten ikke skal have
 * den. På org-kanalen sendes kun data-ændringer: kollegers timer-events
 * (team-live) indeholder deres beskrivelse og projekt og hører ikke hjemme
 * på en enheds strøm.
 */
export function toDeviceStreamEvent(
  channel: string,
  message: string,
): DeviceStreamEvent | null {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(message) as unknown;
    if (!value || typeof value !== "object") return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const isOrgChannel = channel.startsWith("timer:org:");

  if (parsed.type === "data_changed") {
    const domains = Array.isArray(parsed.domains) ? parsed.domains : [];
    const entities = entitiesForDomains(domains);
    return entities.length > 0 ? { type: "data", entities } : null;
  }

  if (isOrgChannel) return null;
  if (
    typeof parsed.type === "string" &&
    ["sync", "stopping", "stopped", "cleared"].includes(parsed.type)
  ) {
    return {
      type: "timer",
      event: parsed.type,
      version: typeof parsed.version === "number" ? parsed.version : 0,
    };
  }
  return null;
}

/** SSE-ramme med løbenummer, så klienten kan se huller efter genforbindelse. */
export function formatDeviceStreamFrame(
  id: number,
  event: DeviceStreamEvent,
): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
