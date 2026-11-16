import { trpcClient } from '~/lib/api/trpc';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';

/**
 * Sæt de valgte tags på en post der lige er gemt.
 *
 * `entryId` er `undefined` når posten endte i offline-køen — så sætter
 * dræningen dem i stedet, lige efter den har oprettet posten (`drain.ts`).
 *
 * Fejl **meldes**, ikke sluges: tiden er gemt, og brugeren skal kunne se at
 * tags mangler. Den tabte tid ville være det virkelige tab, og den kan ikke
 * ske her — `time.create` er allerede gennemført.
 *
 * En tom liste er et gyldigt kald: brugeren kan have fjernet alle tags på en
 * post. Kald derfor altid, når formen har ændret dem.
 */
export async function applyTagsToEntry(entryId: string | undefined, tagIds: string[]): Promise<boolean> {
  if (!entryId)
    return false;
  try {
    await trpcClient.tags.setForEntry.mutate({ entryId, tagIds });
    return true;
  }
  catch {
    showMessage({ message: translate('entries.tags_not_saved'), type: 'danger' });
    return false;
  }
}
