import type { TimeEntry } from './use-entries';
import * as React from 'react';
import { billedStateOf, marksBilled, toggleSelection } from './bulk-select';
import { selectedEntries, useBulkActions } from './use-bulk-actions';

/**
 * Udvalgstilstanden på Tid-skærmen: marker flere poster og behandl dem i ét
 * kald, så «marker seks som fakturerede» ikke er seks handlingsark.
 *
 * Tilstanden bor her og ikke i skærmen, fordi den er en regel med to
 * bivirkninger — den skal forsvinde ved periodskift, og den må kun ramme de
 * poster der faktisk står på skærmen.
 */
export function useEntrySelection(visible: TimeEntry[]) {
  const [active, setActive] = React.useState(false);
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set());
  // Efter en vellykket handling er der intet mere at behandle, så skærmen
  // går tilbage til den normale liste i stedet for at stå med tomme valg.
  const leave = React.useCallback(() => {
    setActive(false);
    setIds(new Set());
  }, []);
  const bulk = useBulkActions(leave);

  const chosen = React.useMemo(() => selectedEntries(visible, ids), [ids, visible]);
  const billedState = React.useMemo(() => billedStateOf(chosen), [chosen]);
  // Kaldene får de id'er, der står på skærmen. Et filter kan skjule en markeret
  // post, og da må handlingen ikke ramme den skjulte post: tallet på knappen og
  // den mængde der ændres skal være den samme.
  const chosenIds = React.useMemo(() => chosen.map(entry => entry.id), [chosen]);

  /** Tryk på en post: marker den i udvalgstilstand, ellers åbn den. */
  const press = React.useCallback((entry: TimeEntry, open: () => void) => {
    if (!active) {
      open();
      return;
    }
    setIds(current => toggleSelection(current, entry.id));
  }, [active]);

  return {
    active,
    leave,
    start: () => setActive(true),
    ids,
    press,
    chosenIds,
    billedState,
    busy: bulk.busy,
    markBilled: () => void bulk.markBilled(chosenIds, marksBilled(billedState)),
    deleteChosen: () => bulk.remove(chosenIds),
  };
}
