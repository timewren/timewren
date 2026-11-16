/** Klient-sikker formatering til aftalen (bruges i PDF og UI). */

const MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/** "11. oktober 2026 kl. 14.05" i dansk tid. */
export function formatDanishDateTime(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Copenhagen",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const month = MONTHS[Number(parts.month) - 1];
  return `${Number(parts.day)}. ${month} ${parts.year} kl. ${parts.hour}.${parts.minute}`;
}
