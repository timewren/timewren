/**
 * Plan for at føje et segment til en post (review P2, audit A2 P1-4).
 *
 * Postens timer efter tilføjelsen = forrige timer + det nye segment. Timerne
 * udledes ALDRIG af postens start→slut-spænd: efter "Fortsæt" beholder posten
 * sin start og får slut = nu, så spændet indeholder pausen, og en manuelt
 * rettet post har timer der ikke matcher spændet. Har posten ingen segmenter
 * endnu, bygges et retroaktivt segment af dens timer, forankret i dens
 * sluttid (eller, uden klokkeslæt, der hvor det nye segment begynder).
 */
export interface SegmentAppendPlan {
  retroSegment: {
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
  } | null;
  newHours: number;
}

export function planSegmentAppend(input: {
  entryHours: number;
  entryStartTime: Date | null;
  entryEndTime: Date | null;
  hasSegments: boolean;
  newStart: Date;
  newEnd: Date;
}): SegmentAppendPlan {
  const entryHours = Number.isFinite(input.entryHours) ? input.entryHours : 0;
  const newMinutes = Math.round(
    (input.newEnd.getTime() - input.newStart.getTime()) / 60000,
  );

  let retroSegment: SegmentAppendPlan["retroSegment"] = null;
  const retroMinutes = Math.round(entryHours * 60);
  if (!input.hasSegments && retroMinutes > 0) {
    const endTime = input.entryEndTime ?? input.newStart;
    retroSegment = {
      startTime: new Date(endTime.getTime() - retroMinutes * 60000),
      endTime,
      durationMinutes: retroMinutes,
    };
  }

  const newHours = Math.round((entryHours + newMinutes / 60) * 100) / 100;
  return { retroSegment, newHours };
}
