import type { QuickStartSelection } from './quick-start';
import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { trpc } from '~/lib/api';
import { isQuickStartable, readQuickStart, RECENT_LIMIT, rememberQuickStart, toQuickStart } from './quick-start';

type RecentTask = RouterOutputs['time']['getRecent'][number];

export type RecentTasks = {
  items: RecentTask[];
  /** Den senest brugte kunde/projekt — fra serveren når vi kan, ellers fra hukommelsen. */
  quickStart: QuickStartSelection | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

/**
 * Én deling af `time.getRecent` mellem Seneste-kortet og hurtig start, så
 * hemskærmen ikke henter to gange. Den nyeste post gemmes lokalt ved hvert svar,
 * så ét-tryk start også virker uden net — `getRecent` kan ikke hentes offline.
 */
export function useRecentTasks(): RecentTasks {
  const query = trpc.time.getRecent.useQuery({ limit: RECENT_LIMIT });
  const newest = query.data?.[0] ?? null;
  const [remembered] = React.useState(readQuickStart);

  React.useEffect(() => {
    if (newest)
      rememberQuickStart(newest);
  }, [newest]);

  const quickStart = newest ? toQuickStart(newest) : remembered;
  return {
    items: query.data ?? [],
    quickStart: isQuickStartable(quickStart) ? quickStart : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
