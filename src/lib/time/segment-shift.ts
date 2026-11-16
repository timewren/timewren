import { entryDateFromStr } from "@/lib/time/copenhagen";

/**
 * Hvor meget en posts segmenter skal forskydes (ms), når posten flyttes til
 * en anden dato. Med en ny starttid følger segmenterne start-flytningen
 * (bevarer klokkeslæt også over sommertidsskiftet); ellers hele dage.
 * Kun tidspunkterne flyttes — segmenternes varighed er uændret.
 */
export function segmentShiftMs(args: {
  oldDate: Date;
  newDateStr: string;
  oldStart: Date | null;
  newStart: string | null | undefined;
}): number {
  const oldDateStr = args.oldDate.toISOString().slice(0, 10);
  if (oldDateStr === args.newDateStr) return 0;
  if (args.oldStart && args.newStart) {
    return new Date(args.newStart).getTime() - args.oldStart.getTime();
  }
  return entryDateFromStr(args.newDateStr).getTime() - args.oldDate.getTime();
}
