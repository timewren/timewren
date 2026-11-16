import { parseLocalDateStr } from "@/lib/format";

/**
 * Tidsrum ("HH:MM"–"HH:MM") på en dato → ISO-tidsstempler til time.create.
 * Bygges ved LOKAL midnat (browseren): new Date("YYYY-MM-DD") ville blive UTC-
 * midnat og ramme dagen før vest for UTC. Slut ≤ start = over midnat.
 * Delt mellem formularen og prompt-feltet på Hjem.
 */
export function rangeToISO(
  dateStr: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { startTime: string; endTime: string } | null {
  if (!startTime || !endTime) return null;
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const start = parseLocalDateStr(dateStr);
  start.setHours(startHour, startMin, 0, 0);
  const end = parseLocalDateStr(dateStr);
  end.setHours(endHour, endMin, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);

  return { startTime: start.toISOString(), endTime: end.toISOString() };
}
