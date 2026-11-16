import * as React from 'react';
import { trpc, useIsOnline } from '~/lib/api';
import { hasRate, previewableHours, ratePreviewLine, ratePreviewSource, shouldPreviewRate } from './rate-preview';

type Input = {
  hours: number | null;
  clientId: string | null;
  projectId: string | null;
  prepaidPackageId: string | null;
};

export type RatePreview = {
  /** "2 t × 750 kr. = 1.500 kr." */
  line: string | null;
  /** Hvor taksten kommer fra, fx et projektnavn */
  source: string | null;
};

const NOTHING: RatePreview = { line: null, source: null };

/** Kaldet sendes aldrig når `enabled` er falsk, men input skal være gyldigt tal. */
const UNUSED_HOURS = 1;

/**
 * Tidspostens pris, mens brugeren skriver.
 *
 * Skjuler sig uden net: serveren kan ikke svare, og en gammel takst fra cache
 * under et felt brugeren lige har ændret er værre end ingen. Et kald der fejler
 * af en anden grund giver heller ingen fejl — en forudsigtning er ikke noget,
 * brugeren skal skulle rette.
 */
export function useRatePreview(input: Input): RatePreview {
  const online = useIsOnline();
  const hours = previewableHours(input.hours);
  const enabled = online && shouldPreviewRate(input);
  const query = trpc.time.previewRate.useQuery(
    { projectId: input.projectId, clientId: input.clientId, hours: hours ?? UNUSED_HOURS },
    { enabled },
  );

  return React.useMemo<RatePreview>(() => {
    const data = query.data;
    if (!enabled || query.isError || hours === null || !hasRate(data))
      return NOTHING;
    return { line: ratePreviewLine(hours, data), source: ratePreviewSource(data) };
  }, [enabled, query.data, query.isError, hours]);
}
