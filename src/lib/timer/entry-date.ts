import { entryDateFromStr, toCopenhagenDateStr } from "@/lib/time/copenhagen";

/**
 * Datoen en post med et starttidspunkt gemmes på: stoppet timer (#650),
 * kalender-konvertering og fremmøde.
 *
 * Regel: posten dateres efter START-tidspunktets danske dato og splittes ikke
 * ved midnat. Det matcher web-timeren, der dater efter `sessionStartTime`, og
 * at én post altid har én dato; en timer startet 23:30 og stoppet 00:30 hører
 * til den dag arbejdet begyndte. Datoen beregnes i Europe/Copenhagen, så
 * resultatet ikke afhænger af processens TZ (prod kører UTC), og gemmes som
 * UTC-midnat — samme konvention som manuelt oprettede poster.
 */
export function entryDateForStart(startedAt: Date): Date {
  return entryDateFromStr(toCopenhagenDateStr(startedAt));
}
