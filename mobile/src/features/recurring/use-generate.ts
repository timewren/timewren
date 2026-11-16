import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { useInvalidateEntries } from '~/features/entries/use-entries';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';

type Generated = RouterOutputs['recurring']['generate'];

/**
 * Ét genereringskald pr. skabelon, uanset hvor mange tryk der lander.
 *
 * `recurring.generate` er **ikke** idempotent: hvert kald indsætter en ny
 * `timeEntries`-række og en ny `generatedTimeEntries`-række. To tryk under en
 * ark-animation — eller et tryk, fordi det første svar er langsomt — giver så
 * to registreringer af de samme timer. Samme greb som `duplicateFlight` og
 * `billedFlight`: det andet kald får **samme promise** og dermed samme svar,
 * og kun ét svar tales af.
 */
const generateFlight = createInFlight<Generated | null>();

/**
 * Registrer én skabelons timer nu.
 *
 * Vi sender ingen dato. Serverens `generate` skriver `new Date()` i
 * `timeEntries.date` — præcis som cron'en gør (`date: now` i
 * `api/cron/recurring/route.ts`). En dato her ville altså skrive tiden på en
 * anden dag end den automatiske vej gør det.
 */
export function useGenerate() {
  const utils = trpc.useUtils();
  const invalidateEntries = useInvalidateEntries();
  const generate = trpc.recurring.generate.useMutation();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const generateRow = React.useCallback(
    (templateId: string) =>
      generateFlight(templateId, async () => {
        setBusyId(templateId);
        try {
          const entry = await generate.mutateAsync({ templateId });
          // Skabelonen rykkede `nextDue` frem, så den skal ud af «klar»-listen,
          // og den nye post hører hjem i tidslisten, ugeoversigten og klippekortet.
          void utils.recurring.invalidate();
          invalidateEntries();
          showMessage({ message: translate('recurring.generated'), type: 'success' });
          return entry;
        }
        catch (error) {
          showMessage({ message: errorMessage(error), type: 'danger' });
          return null;
        }
        finally {
          setBusyId(null);
        }
      }),
    [generate, invalidateEntries, utils],
  );

  return { generateRow, busyId };
}
