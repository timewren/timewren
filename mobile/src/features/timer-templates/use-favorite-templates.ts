import type { Favorite, TimerTemplate } from './template-logic';
import type { StartOptions } from '~/features/timer/use-timer';
import * as React from 'react';
import { trpc } from '~/lib/api';
import { startFavorite, toFavorites } from './template-logic';

type FavoriteTemplates = {
  favorites: Favorite[];
  /**
   * Ét tryk: start favoritten med skærmens egen `start`, så den interne
   * `isBusy` tæller med og knappen låses som ved et almindeligt tryk på Start.
   */
  start: (template: TimerTemplate, start: (opts: StartOptions) => Promise<boolean>) => Promise<boolean>;
};

/**
 * Favoritterne fra serverens egen skabelliste. Den holdes ikke i MMKV: en
 * skabelon, der slettes på web, skal forsvinde her, og kun en ny hentning
 * kan vide det. Uden net fejler kaldet, og rækken er tom — da står
 * `home.quickStart`-cachen på Hjem som offline-fallback, så ét-tryk start
 * stadig findes, bare uden skabelernes navne.
 */
export function useFavoriteTemplates(): FavoriteTemplates {
  const utils = trpc.useUtils();
  const query = trpc.timerTemplates.list.useQuery({ favoritesOnly: true });
  const recordUsage = trpc.timerTemplates.recordUsage.useMutation();

  const favorites = React.useMemo(() => toFavorites(query.data), [query.data]);

  const start = React.useCallback((template: TimerTemplate, startTimer: (opts: StartOptions) => Promise<boolean>) => startFavorite(template, {
    start: startTimer,
    recordUsage: id => recordUsage.mutateAsync({ id }),
    invalidate: () => utils.timerTemplates.invalidate(),
  }), [recordUsage, utils]);

  return { favorites, start };
}
