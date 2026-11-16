import type { TimeEntry } from './use-entries';
import * as React from 'react';
import { Alert } from 'react-native';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';
import { requiresConnection, showApiError, useInvalidateEntries } from './use-entries';

/**
 * Ét kald pr. handling ad gangen. Nøglen er konstant, fordi der kun kan være
 * én udvalgelse på skærmen: to tryk på "Slet" må ikke slette to gange, og to
 * tryk på "Faktureret" må ikke give to kvitteringer.
 */
const billedFlight = createInFlight<void>();
const deleteFlight = createInFlight<void>();

type CountKey = 'entries.bulk_billed' | 'entries.bulk_unbilled' | 'entries.bulk_deleted';
type CountPath = 'entries.bulk_billed_one' | 'entries.bulk_billed_other'
  | 'entries.bulk_unbilled_one' | 'entries.bulk_unbilled_other'
  | 'entries.bulk_deleted_one' | 'entries.bulk_deleted_other';

/**
 * Pluralformen vælges her, ikke af i18next: `TxKeyPath` er en statisk sti, så
 * `translate('entries.bulk_billed', …)` findes ikke i typen. Mønstret er det
 * samme som `client-row.tsx`.
 */
function countKey(base: CountKey, count: number): CountPath {
  return (count === 1 ? `${base}_one` : `${base}_other`) as CountPath;
}

function toast(base: CountKey, count: number) {
  showMessage({ message: translate(countKey(base, count), { count }), type: 'success' });
}

/**
 * Behandl mange poster i ét kald: `time.bulkMarkBilled` og `time.bulkDelete`.
 *
 * Begge er **server**-handlinger på eksisterende data, så de kan ikke ligge i
 * offline-køen: kø-inputtet er bare `{ ids }`, som dræningen ikke kan
 * genskabe til et kald (jf. `requiresConnection`), og for `bulkDelete` er et
 * genforsøg efter tabt svar ikke bare dobbeltarbejde — det sletter igen.
 * Begge siger det ærligt frem for at vise en rød netværksfejl.
 */
export function useBulkActions(onDone?: () => void) {
  const invalidate = useInvalidateEntries();
  const utils = trpc.useUtils();
  const markBilledMutation = trpc.time.bulkMarkBilled.useMutation({ onError: showApiError });
  const deleteMutation = trpc.time.bulkDelete.useMutation({ onError: showApiError });

  const markBilled = React.useCallback((ids: string[], isBilled: boolean) => {
    if (ids.length === 0)
      return Promise.resolve();
    const action = isBilled ? 'entries.actions.mark_billed' : 'entries.actions.unmark_billed';
    if (requiresConnection(translate(action)))
      return Promise.resolve();
    return billedFlight('bulk', async () => {
      await markBilledMutation.mutateAsync({ ids, isBilled });
      invalidate();
      // `isBilled ⟺ fakturalinje` er serverens egen invariant, så fakturaer
      // skal genindlæses med posterne — samme krydsinvalidering som
      // den enkelte post i `use-entries`.
      void utils.invoices.invalidate();
      toast(isBilled ? 'entries.bulk_billed' : 'entries.bulk_unbilled', ids.length);
      onDone?.();
    }).catch(() => {});
  }, [invalidate, markBilledMutation, onDone, utils]);

  const runDelete = React.useCallback((ids: string[]) => {
    void deleteFlight('bulk', async () => {
      await deleteMutation.mutateAsync({ ids });
      invalidate();
      toast('entries.bulk_deleted', ids.length);
      onDone?.();
    }).catch(() => {});
  }, [deleteMutation, invalidate, onDone]);

  /**
   * Slet de valgte poster — altid bag en bekræftelse, og antallet står i
   * både titel og brødtekst. "Slet registrering?" ved 12 valgte ville være en
   * modal uden oplysninger om hvor meget der forsvinder.
   */
  const remove = React.useCallback((ids: string[]) => {
    const count = ids.length;
    if (count === 0)
      return;
    Alert.alert(
      translate(count === 1 ? 'entries.bulk_delete_title_one' : 'entries.bulk_delete_title_other', { count }),
      translate(count === 1 ? 'entries.bulk_delete_body_one' : 'entries.bulk_delete_body_other', { count }),
      [
        { text: translate('entries.actions.cancel'), style: 'cancel' },
        { text: translate('entries.actions.delete'), style: 'destructive', onPress: () => runDelete(ids) },
      ],
    );
  }, [runDelete]);

  /** Sandt mens et kald er i luften, så knapperne låser i stedet for at fyre igen. */
  const busy = markBilledMutation.isPending || deleteMutation.isPending;
  return { markBilled, remove, busy };
}

/** De valgte poster, i den rækkefølge de står på skærmen. */
export function selectedEntries(entries: TimeEntry[], ids: ReadonlySet<string>): TimeEntry[] {
  return entries.filter(entry => ids.has(entry.id));
}
