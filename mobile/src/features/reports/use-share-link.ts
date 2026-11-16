import type { CreatedLink, ShareConfig } from './report-share-logic';
import type { RouterInputs } from '~/api/app-router';
import * as React from 'react';
import { Share as RNShare } from 'react-native';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';
import { shareMessage } from './report-share-logic';

type CreateInput = { config: ShareConfig; name: string; lockDates: boolean };

/**
 * Ét oprettelseskald ad gangen. `createShareLink` er **ikke** idempotent: hvert
 * kald indsætter en ny `report_shares`-række med sit eget token, så to tryk
 * under en ark-animation gav to links — og brugeren fik kun den første, fordi
 * det andet svar aldrig blev vist. Samme greb som `useGenerate`s `generateFlight`.
 *
 * **Delingen ligger inde i låsen**, ikke ved siden af den. Låsen giver det andet
 * tryk *samme promise*, så et `.then` på den ville køre to gange og åbne to
 * share-ark for ét link.
 */
const createFlight = createInFlight<CreatedLink | null>();

/**
 * Ét tilbagekaldelseskald pr. link. `revokeShareLink` matcher kun rækker med
 * `revokedAt IS NULL`, så det **andet** kald kaster `NOT_FOUND` — brugeren så
 * en fejl efter en handling der lykkedes. Nøglen er linkets id, så to forskellige
 * godt må forsvinde samtidig.
 */
const revokeFlight = createInFlight<string | null>();

/** Nøglen `busyId` får, mens et nyt link oprettes. Kan ikke være et uuid. */
export const CREATING = 'create';

/**
 * Opret og tilbagekald delte rapporter.
 *
 * Begge mutationer ændrer `listShareLinks` — den nye række skal kunne ses med det
 * samme, og en tilbagekaldt skal forsvinde — så vi invaliderer hele `reports`.
 */
export function useShareLink() {
  const utils = trpc.useUtils();
  const create = trpc.reports.createShareLink.useMutation();
  const revoke = trpc.reports.revokeShareLink.useMutation();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const createLink = React.useCallback(
    (input: CreateInput) =>
      createFlight(CREATING, async () => {
        setBusyId(CREATING);
        try {
          const link = await create.mutateAsync(input);
          // Rækken vokser pr. konto, så både det nye link og et tilbagekaldt
          // forsvinder fra listen uden at brugeren skal trække for at se det.
          void utils.reports.invalidate();
          showMessage({ message: translate('reports.share.created'), type: 'success' });
          // Serverens egen URL: vores base-URL er ikke nødvendigvis `getAppUrl()`.
          const message = shareMessage(link);
          if (message)
            await RNShare.share({ message });
          return link;
        }
        catch (error) {
          showMessage({ message: errorMessage(error), type: 'danger' });
          return null;
        }
        finally {
          setBusyId(null);
        }
      }),
    [create, utils],
  );

  const revokeLink = React.useCallback(
    (id: string) =>
      revokeFlight(id, async () => {
        setBusyId(id);
        try {
          await revoke.mutateAsync({ id });
          void utils.reports.invalidate();
          showMessage({ message: translate('reports.share.deleted'), type: 'success' });
          return id;
        }
        catch (error) {
          showMessage({ message: errorMessage(error), type: 'danger' });
          return null;
        }
        finally {
          setBusyId(null);
        }
      }),
    [revoke, utils],
  );

  return { createLink, revokeLink, busyId };
}

/** Input-typen direkte fra routeren, så et kald ikke kan afvise en gyldig config. */
export type CreateShareLinkInput = RouterInputs['reports']['createShareLink'];
