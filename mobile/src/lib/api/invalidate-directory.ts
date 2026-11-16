import * as React from 'react';
import { trpc } from './trpc';

/**
 * Rutere hvis svar indeholder et kunde- eller projektnavn.
 *
 * Et navn ligger i mange payloads *uden* at den kaldte klient/project-ruter:
 * `time.list` medtager `project.client.name`, `invoices.list` kundenavnet,
 * `timerTemplates.list` begge, `logbook.dayDetail` dem begge i hver pause, og
 * flere (`projects.healthStatus`, `clients.getAtRiskClients`,
 * `search.global`, `team.liveTimers`) returnerer navnet som en denormaliseret
 * streng. Denormaliseret betyder: serveren skriver navnet *ind* i svaret, så
 * klienten henter det ikke selv — det kan derfor ikke blive nyt ved at
 * invalidere `clients`.
 *
 * Listen er bevidst bredere end de steder der *maler* et navn: en procedure
 * der kun har tallene (`time.todayTotal`) koster intet at rydde, fordi
 * `invalidate` kun genhenter de queries der faktisk er i brug.
 */
export const NAME_CARRYING_ROUTERS = [
  'approvalRequests',
  'cashflow',
  'clients',
  'enterprise',
  'invoices',
  'logbook',
  'prepaid',
  'projects',
  'reports',
  'search',
  'tasks',
  'team',
  'time',
  'timerTemplates',
] as const;

export type NameCarryingRouter = (typeof NAME_CARRYING_ROUTERS)[number];

type Invalidateable = { invalidate: () => unknown };
export type DirectoryUtils = Record<NameCarryingRouter, Invalidateable>;

/**
 * En kunde eller et projekt blev oprettet, omdøbt eller arkiveret. Ryd
 * hele navne-kredsen, så ingen skærm står med det gamle navn.
 *
 * Uden dette stod det gamle navn på tidsskærmen, klippekort, fakturaer,
 * opgaver, timske/skabeloner, logbog, rapporter, søgning og hold-visningen i
 * op til fem minutter (`staleTime`), fordi hver af dem hentede navnet ind i sit
 * eget svar.
 */
export function invalidateDirectory(utils: DirectoryUtils): void {
  for (const router of NAME_CARRYING_ROUTERS)
    void utils[router].invalidate();
}

/** Hook-version af `invalidateDirectory` — brug den i `onSuccess`/`onSettled`. */
export function useInvalidateDirectory(): () => void {
  const utils = trpc.useUtils();
  return React.useCallback(() => invalidateDirectory(utils), [utils]);
}
