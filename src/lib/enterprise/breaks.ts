/**
 * Ubetalt pause (#449) — rene helpers oven på applyUnpaidBreak, delt af
 * check-ud, check-ind-status og lønrapporten så fradraget altid beregnes ens:
 * pr. bruger pr. dag ud fra dagens samlede tilstedeværelse.
 */
import { toLocalDateStr } from "@/lib/format";
import { unpaidBreakDeduction } from "./timesheet";

export type PresenceSession = {
  userId: string;
  checkedInAt: Date;
  checkedOutAt: Date | null;
};

/** Timer mellem check-ind og check-ud (åbne sessioner tæller 0). */
export function sessionHours(session: PresenceSession): number {
  if (!session.checkedOutAt) return 0;
  return (
    (session.checkedOutAt.getTime() - session.checkedInAt.getTime()) / 3_600_000
  );
}

/** Samlet tilstedeværelse pr. `userId|YYYY-MM-DD` (dag = check-ind-dagen). */
export function presenceByUserDay(
  sessions: PresenceSession[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const hours = sessionHours(s);
    if (hours <= 0) continue;
    const key = `${s.userId}|${toLocalDateStr(s.checkedInAt)}`;
    map.set(key, (map.get(key) ?? 0) + hours);
  }
  return map;
}

/**
 * Pause fratrukket (timer) pr. bruger for en mængde sessioner — kolonnen
 * 'Pause fratrukket (timer)' i lønrapporten. Kun brugere med et fradrag > 0
 * optræder i resultatet.
 */
export function unpaidBreakHoursByUser(
  sessions: PresenceSession[],
  breakMinutesFor: (userId: string) => number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, presence] of presenceByUserDay(sessions)) {
    const userId = key.slice(0, key.indexOf("|"));
    const deducted = unpaidBreakDeduction(breakMinutesFor(userId), presence);
    if (deducted <= 0) continue;
    result.set(
      userId,
      Math.round(((result.get(userId) ?? 0) + deducted) * 100) / 100,
    );
  }
  return result;
}
