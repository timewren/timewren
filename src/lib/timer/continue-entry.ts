import { isBilledLocked } from "@/lib/time/billed-lock";

/**
 * "Fortsæt" en eksisterende postering (kunde A 1/10).
 *
 * Tidligere blev postens starttid og dato overskrevet med tidspunktet for
 * "Fortsæt", så posten ikke længere passede med ankomsten. Nu forlænges
 * posten kun: timer = postens timer + den nye session, sluttid = nu. Start og
 * dato røres ikke.
 *
 * Returnerer null når posten ikke kan forlænges (faktureret/låst) — så skal
 * sessionen gemmes som en ny post.
 */
export function buildContinuedEntryPatch(input: {
  original: {
    date: Date | string;
    startTime: Date | string | null;
    endTime?: Date | string | null;
    isBilled: boolean | null;
    invoiceId?: string | null;
  };
  /** Timer der stod på posten, da "Fortsæt" blev trykket. */
  continuingEntryHours: number;
  /** Den nye sessions egen tid (sekunder). */
  sessionSeconds: number;
  endTime: Date;
}): { hours: number; date: string; endTime?: string } | null {
  if (isBilledLocked(input.original)) return null;

  const base = Number.isFinite(input.continuingEntryHours)
    ? Math.max(0, input.continuingEntryHours)
    : 0;
  const session = Math.max(0, input.sessionSeconds) / 3600;
  const hours = Math.max(0.01, Math.round((base + session) * 100) / 100);

  // time_entries.date er UTC-midnat på den danske dato.
  const date = new Date(input.original.date).toISOString().slice(0, 10);

  const start = input.original.startTime
    ? new Date(input.original.startTime)
    : null;
  const endTime =
    start && input.endTime.getTime() > start.getTime()
      ? input.endTime.toISOString()
      : undefined;

  return endTime ? { hours, date, endTime } : { hours, date };
}
