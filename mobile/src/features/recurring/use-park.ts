import type { ParkAction } from './recurring-logic';
import * as React from 'react';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';

const parkFlight = createInFlight<string | null>();

/**
 * Ét pause-, genoptagelses- eller til-knap-kald pr. skabelon, uanset hvor mange tryk.
 *
 * Alle tre mutationer er **flips**: `pause` sætter `isPaused = true`,
 * `resume` sætter den til false, og `toggleActive` sætter `isActive =
 * !template.isActive` — den læser serverens værdi, ikke vores egen. De er så
 * ikke idempotent i den forstand, at et ekstra kald efter et netværksfejl kan
 * **vende** skabelonen tilbage: to tryk under en ark-animation kunne pause og
 * genoptage i samme bevægelse, så brugeren så den gå i pause og straks komme
 * ud igen. `toggleActive` er den værste af dem, fordi den ikke engang kan se,
 * at den har gjort det før. Samme greb som `generateFlight` og
 * `duplicateFlight`: det andet kald får samme promise.
 *
 * Nøglen er handlingen **og** skabelonen, så to forskellige skabeloner godt
 * må behandles samtidig, mens to tryk på den samme ikke kan.
 */
const ACTION_KEY: Record<ParkAction, string> = {
  pause: 'pause',
  resume: 'resume',
  activate: 'activate',
};

const TOAST: Record<ParkAction, 'recurring.paused_toast' | 'recurring.resumed_toast' | 'recurring.activated_toast'> = {
  pause: 'recurring.paused_toast',
  resume: 'recurring.resumed_toast',
  activate: 'recurring.activated_toast',
};

/**
 * Sæt en skabelon på pause, genoptag den, eller slå den til igen.
 *
 * Vi sender **ingen** `pausedUntil`. Serveren tager gerne imod den og skriver
 * den i kolonnen, men ingen læser den — cron'en og `getPending` prøver kun
 * `isPaused = false` — så en feriepause med dato ville være et løfte om en
 * automatisk genoptagelse, der aldrig kommer. Genoptagelsen er derfor en
 * bevidst handling, brugeren tager bagefter, og skærmen siger det.
 *
 * Efter et kald invaliderer vi hele `recurring`-rummet: både `getPending` og
 * `list` henter `isPaused` og `isActive`, så uden invalidering ville rækken stå
 * med den gamle badge ind næste opdatering — og «Klar nu» ville stadig vise en
 * pauset skabelon, fordi `getPending` svarer serverens filtre, ikke vores.
 */
export function usePark() {
  const utils = trpc.useUtils();
  const pause = trpc.recurring.pause.useMutation();
  const resume = trpc.recurring.resume.useMutation();
  const toggleActive = trpc.recurring.toggleActive.useMutation();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const parkRow = React.useCallback(
    (templateId: string, action: ParkAction) =>
      parkFlight(`${ACTION_KEY[action]}:${templateId}`, async () => {
        setBusyId(templateId);
        try {
          if (action === 'pause')
            await pause.mutateAsync({ id: templateId });
          else if (action === 'resume')
            await resume.mutateAsync({ id: templateId });
          else
            await toggleActive.mutateAsync({ id: templateId });
          showMessage({ message: translate(TOAST[action]), type: 'success' });
          void utils.recurring.invalidate();
        }
        catch (error) {
          showMessage({ message: errorMessage(error), type: 'danger' });
          return null;
        }
        finally {
          setBusyId(null);
        }
        return templateId;
      }),
    [pause, resume, toggleActive, utils],
  );

  return { parkRow, busyId };
}
