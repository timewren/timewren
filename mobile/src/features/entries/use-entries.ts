import type { EntryFilter } from './entry-filter';
import type { DateRange } from './period';
import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { Alert } from 'react-native';
import { isOffline } from '~/features/offline/enqueue';
import { runOrQueue } from '~/features/offline/run-or-queue';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';
import { entriesQueryInput, NO_FILTER } from './entry-filter';

export type TimeEntry = RouterOutputs['time']['list']['entries'][number];
export type TimeEntryDetail = RouterOutputs['time']['getById'];

export function useEntriesInRange(range: DateRange, filter: EntryFilter = NO_FILTER) {
  return trpc.time.list.useQuery(entriesQueryInput(range, filter));
}

/** Tid påvirker klippekort-saldi, dashboard og timer — invalidér på tværs. */
export function useInvalidateEntries() {
  const utils = trpc.useUtils();
  return React.useCallback(() => {
    void utils.time.invalidate();
    void utils.prepaid.invalidate();
    void utils.dashboard.invalidate();
    void utils.timerSync.invalidate();
  }, [utils]);
}

export function showApiError(error: unknown) {
  showMessage({ message: errorMessage(error), type: 'danger' });
}

function toast(key: 'entries.deleted' | 'entries.duplicated' | 'entries.saved' | 'entries.created') {
  showMessage({ message: translate(key), type: 'success' });
}

/**
 * Handlinger der kræver serveren og derfor IKKE kan ligge i offline-køen.
 *
 * `duplicate` og `copyWeek` er *server*-handlinger på eksisterende data: de
 * læser den oprindelige post og danner en ny. Inputtet er kun et id (eller en
 * uge), så køen kan ikke rekonstruere mutationen, og et genforsøg efter tabt
 * svar ville dobbeltfakturere. I stedet siger vi brugeren det ærligt, frem for
 * at vise en rød netværksfejl og lade det se ud som om handlingen gik tabt.
 */
export function requiresConnection(action: string): boolean {
  if (!isOffline())
    return false;
  showMessage({
    message: translate('offline.needs_connection', { action }),
    description: translate('offline.needs_connection_body'),
    type: 'warning',
  });
  return true;
}

/**
 * Ét duplikér-kald pr. post ad gangen.
 *
 * `duplicate` er en server-handling, der danner en NY post for hvert kald, så
 * to kald er to tidsposter — altså dobbeltfaktureret tid. Der er ingen genopret-
 * ning at falde tilbage på: handlingsarket (`entry-actions-sheet.tsx`) lukker
 * først efter trykket, så et dobbelttryk under dismiss-animation(~250 ms) er
 * nok. Nøglen er postens `id`, så to *forskellige* poster stadig må duplikeres
 * sideløbs.
 */
const duplicateFlight = createInFlight<void>();

/** Ét `bulkMarkBilled`-kald pr. post ad gangen — nøglen er postens id. */
const billedFlight = createInFlight<void>();

/** Slet / dupliker / skift fakturerbar — med invalidering og toasts. */
export function useEntryActions() {
  const invalidate = useInvalidateEntries();
  // Uden callbacks: `removeOrQueue` ejer beskeden, så den kan skelne mellem
  // "gemt" og "lagt i køen" — og en mutation-option ville fyre begge steder.
  const remove = trpc.time.delete.useMutation();
  const duplicateMutation = trpc.time.duplicate.useMutation({
    onSuccess: () => {
      invalidate();
      toast('entries.duplicated');
    },
    onError: showApiError,
  });
  /**
   * Dupliker — kan ikke køes offline (se `requiresConnection`), så den siger
   * det ærligt frem for at vise en netværksfejl. Efter et tabt svar ville et
   * genforsøg desuden have lavet to kopier af samme time. Dobbelttrykket er
   * låst i `duplicateFlight`, så det danner kun én ny post.
   */
  const duplicate = React.useCallback((id: string, onDone?: () => void) => {
    if (requiresConnection(translate('entries.actions.duplicate'))) {
      onDone?.();
      return Promise.resolve();
    }
    // Kun den der fik kallet låst af siger fra: ellers gør et dobbelttryk
    // `router.back()` to gange og popper to skærme.
    let owner = false;
    return duplicateFlight(id, async () => {
      owner = true;
      await duplicateMutation.mutateAsync({ id });
    })
      .then(() => {
        if (owner)
          onDone?.();
      })
      // `onError` viser beskeden; her skal et afvist kald bare tie stilheds.
      .catch(() => {});
  }, [duplicateMutation]);
  const toggleBillableMutation = trpc.time.toggleBillable.useMutation();
  const toggleBusyRef = React.useRef(false);
  /** Skift fakturerbar — eller læg skiftet i offline-køen når der ikke er net. */
  const toggleBillable = React.useCallback((id: string, isBillable: boolean) => {
    // To korte tryk på ark-handlingen ville ellers give to kø-elementer der
    // sætter feltet til hver sin værdi, og den der kom først taber.
    if (toggleBusyRef.current)
      return;
    toggleBusyRef.current = true;
    void (async () => {
      try {
        const outcome = await runOrQueue({ type: 'time.toggleBillable', payload: { id, isBillable } }, () => toggleBillableMutation.mutateAsync({ id, isBillable }));
        if (outcome.kind === 'sent')
          invalidate();
      }
      catch (error) {
        showApiError(error);
      }
      finally {
        toggleBusyRef.current = false;
      }
    })();
  }, [invalidate, toggleBillableMutation]);
  const markBilledMutation = trpc.time.bulkMarkBilled.useMutation({ onError: showApiError });
  const utils = trpc.useUtils();
  /**
   * Markér som faktureret / ikke-faktureret — `time.bulkMarkBilled` med ét id.
   *
   * Kan **ikke** køes offline: kø-inputtet er bare `{ id, isBilled }`, så
   * dræningen kan ikke rekonstruere mutationen, og — vigtigere — serverens
   * egen invariant er `isBilled ⟺ fakturalinje` (`invoices.ts:232-234`). Et
   * kø-element ville stå og lyve om en post, der faktisk er faktureret.
   * Samme regel som `duplicate` og `copyWeek`.
   *
   * Dobbelttrykket låses pr. id: to kald er ikke farlige (mutationen er
   * idempotent), men de ville give to kvitteringer og to invalideringer.
   */
  const setBilled = React.useCallback((id: string, isBilled: boolean) => {
    if (requiresConnection(translate(isBilled ? 'entries.actions.mark_billed' : 'entries.actions.unmark_billed')))
      return Promise.resolve();
    return billedFlight(id, async () => {
      await markBilledMutation.mutateAsync({ ids: [id], isBilled });
      invalidate();
      void utils.invoices.invalidate();
      showMessage({ message: translate(isBilled ? 'entries.billed_done' : 'entries.unbilled_done'), type: 'success' });
    }).catch(() => {});
  }, [invalidate, markBilledMutation, utils]);
  /** Slet — eller læg sletningen i offline-køen når der ikke er net. */
  const removeOrQueue = React.useCallback((id: string, onDone?: () => void) => {
    void (async () => {
      try {
        const outcome = await runOrQueue({ type: 'time.delete', payload: { id } }, () => remove.mutateAsync({ id }));
        if (outcome.kind === 'sent') {
          invalidate();
          toast('entries.deleted');
        }
      }
      catch (error) {
        showApiError(error);
      }
      finally {
        onDone?.();
      }
    })();
  }, [invalidate, remove]);
  return { remove, duplicate, duplicatePending: duplicateMutation.isPending, toggleBillable, setBilled, removeOrQueue };
}

/** Native bekræftelse før sletning. */
export function confirmDelete(onConfirm: () => void) {
  Alert.alert(
    translate('entries.delete_title'),
    translate('entries.delete_body'),
    [
      { text: translate('entries.actions.cancel'), style: 'cancel' },
      { text: translate('entries.actions.delete'), style: 'destructive', onPress: onConfirm },
    ],
  );
}
