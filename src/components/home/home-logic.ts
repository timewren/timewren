/**
 * Ren logik til Hjem — ingen React, så den kan testes i vitest.
 */

export interface HomeDraft {
  hours: number | null;
  description: string;
  clientId: string | null;
  projectId: string | null;
  /** Kunder/projekter er slået til → posten skal have én af dem */
  requireClientOrProject: boolean;
}

/** Kan forslaget gemmes direkte fra Hjem? (ellers: ret i formularen) */
export function canSaveHomeDraft(d: HomeDraft): boolean {
  if (d.hours === null || !(d.hours > 0)) return false;
  if (!d.description.trim()) return false;
  if (d.requireClientOrProject && !d.clientId && !d.projectId) return false;
  return true;
}

/** Skriver brugeren i et felt? Så må "/" ikke stjæle tasten. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.getAttribute?.("role") === "textbox";
}

/** Nøgle i home.greeting for tidspunktet på dagen. */
export function greetingKey(
  hour: number,
): "night" | "morning" | "forenoon" | "afternoon" | "evening" {
  if (hour < 5) return "night";
  if (hour < 10) return "morning";
  if (hour < 12) return "forenoon";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "God nat";
  if (hour < 10) return "God morgen";
  if (hour < 12) return "God formiddag";
  if (hour < 18) return "God eftermiddag";
  return "God aften";
}

/** "2 t 15 min" / "45 min" / "0 min" (enheder kan gives pr. sprog) */
export function formatDuration(
  hours: number,
  units: { h: string; min: string } = { h: "t", min: "min" },
): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} ${units.min}`;
  if (m === 0) return `${h} ${units.h}`;
  return `${h} ${units.h} ${m} ${units.min}`;
}

/** "09:15–11:00" i dansk tid, eller null uden tidsrum */
export function formatRange(
  start: Date | string | null,
  end: Date | string | null,
  intlLocale = "da-DK",
): string | null {
  if (!start || !end) return null;
  const fmt = (v: Date | string) =>
    new Date(v).toLocaleTimeString(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Copenhagen",
    });
  return `${fmt(start)}–${fmt(end)}`;
}

/** Chip-tekst: projekt (med kunde under) eller kunden alene */
export function quickStartLabel(
  item: {
    projectName: string | null;
    clientName: string | null;
  },
  unnamed = "Uden navn",
): { primary: string; secondary: string | null } {
  if (item.projectName) {
    return { primary: item.projectName, secondary: item.clientName };
  }
  return { primary: item.clientName ?? unnamed, secondary: null };
}
