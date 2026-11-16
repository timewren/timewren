import type { RouterOutputs } from '~/api/app-router';
import type { QuickStartSelection } from '~/features/home/quick-start';
import type { StartOptions } from '~/features/timer/use-timer';
import { quickStartLabel } from '~/features/home/quick-start';

/**
 * Timer-skabeloner og favoritter — serverens egen liste (`timerTemplates.*`),
 * ikke en lokal cache. Web'en rækkefølger dem favoritter → mest brugte →
 * senest brugte, og det samme gør vi, så en skabelon der slettes på web
 * forsvinder her ved næste invalidate i stedet for at overleve i hukommelsen.
 *
 * Uden net kan listen ikke hentes. Da står den eksisterende
 * `home.quickStart`-cache (ét-tryk start fra Hjem) tilbage som offline-fallback,
 * så rækken forsvinder aldrig helt — den bliver bare kortere.
 */

export type TimerTemplate = RouterOutputs['timerTemplates']['list'][number];

/** En favorit, klar til ét tryk: skabelonen selv plus etiketten til skærmlæseren. */
export type Favorite = {
  id: string;
  name: string;
  /** "Kunde · Projekt" — navnet alene er for kort, når kunden er ukendt. */
  label: string;
  template: TimerTemplate;
};

/**
 * Skabelon → startvalg. Kunden kommer fra skabelonens egen relation eller fra
 * projektets kunde, så en skabelon kun med projekt stadig får kundenavn med.
 *
 * Uden kunde og projekt er starten en anonym intern registrering, som er svær at
 * rette senere — så den tilbydes ikke, ligesom hurtig start gør det. Kolonnen
 * er `onDelete: set null`, så et slettet projekt efterlader skabelonen uden
 * `projectId` i stedet for med en relation, der peger på noget dødt.
 */
export function templateToStart(template: TimerTemplate): QuickStartSelection | null {
  const client = template.client ?? template.project?.client ?? null;
  if (!template.projectId && !template.clientId)
    return null;
  return {
    projectId: template.projectId ?? null,
    clientId: template.clientId ?? client?.id ?? null,
    taskId: null,
    description: template.description ?? '',
    projectName: template.project?.name ?? null,
    clientName: client?.name ?? null,
  };
}

/** Serverlisten → de favoritter der faktisk kan startes, i serverens rækkefølge. */
export function toFavorites(templates: TimerTemplate[] | undefined): Favorite[] {
  return (templates ?? []).flatMap((template) => {
    const selection = templateToStart(template);
    if (!selection)
      return [];
    return [{
      id: template.id,
      name: template.name,
      label: quickStartLabel(selection, template.name),
      template,
    }];
  });
}

type StartDeps = {
  start: (opts: StartOptions) => Promise<boolean>;
  recordUsage: (id: string) => Promise<unknown>;
  invalidate: () => unknown;
};

/**
 * Start en favorit med ét tryk og tæl brugen op, så serverens rækkefølge
 * (favoritter → mest brugte → senest brugte) følger den, brugeren faktisk har.
 *
 * Optællingen er kosmetik, så en fejl må aldrig stå i vejen for timeren eller
 * give en fejl-dialog — derfor svellende håndtering. Den kan heller ikke give
 * dobbeltfakturering: den rører kun sorteringen, ikke tidsposterne.
 */
export async function startFavorite(template: TimerTemplate, deps: StartDeps): Promise<boolean> {
  const selection = templateToStart(template);
  if (!selection)
    return false;
  const started = await deps.start(selection);
  if (!started)
    return false;
  void deps.recordUsage(template.id).then(deps.invalidate, deps.invalidate);
  return true;
}
