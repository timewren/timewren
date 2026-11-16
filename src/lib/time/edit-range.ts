/**
 * Hold start/slut i trit med dato og timer, når en post redigeres.
 *
 * - Ny dato: start og slut flyttes samme antal kalenderdage og beholder
 *   deres lokale klokkeslæt (også hen over sommertidsskiftet).
 * - Ændrede timer: slut = start + timer (reelle millisekunder).
 * - Uændrede timer: spændet bevares, så en timerpost med pause (timer <
 *   spænd) ikke får sin sluttid omskrevet, blot fordi datoen flyttes.
 *
 * Returnerer null når posten ikke har et tidsrum, eller intet skal ændres.
 */
export function adjustRangeForEdit(args: {
  startTime: Date | null;
  endTime: Date | null;
  oldDateStr: string;
  newDateStr: string;
  oldHours: number;
  newHours: number;
}): { startTime: Date; endTime: Date } | null {
  const { startTime, endTime } = args;
  if (!startTime || !endTime) return null;

  const dayDiff = calendarDayDiff(args.oldDateStr, args.newDateStr);
  const hoursChanged =
    Math.round(args.oldHours * 3600) !== Math.round(args.newHours * 3600);
  if (dayDiff === 0 && !hoursChanged) return null;

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (dayDiff !== 0) {
    // Lokale settere: klokkeslættet bevares, også over et sommertidsskift
    start.setDate(start.getDate() + dayDiff);
    end.setDate(end.getDate() + dayDiff);
  }
  if (hoursChanged && args.newHours > 0) {
    return {
      startTime: start,
      endTime: new Date(
        start.getTime() + Math.round(args.newHours * 3_600_000),
      ),
    };
  }
  return { startTime: start, endTime: end };
}

function calendarDayDiff(fromStr: string, toStr: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  const diff = Math.round((toUtc(toStr) - toUtc(fromStr)) / 86_400_000);
  return Number.isFinite(diff) ? diff : 0;
}
