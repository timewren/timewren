"use client";

import { useState } from "react";

/**
 * Visningsværdi for serverdata med en optimistisk overstyring.
 *
 * `useState(initialProp)` kopierer kun propen ved første mount — en rækkes
 * timer/beskrivelse blev derfor stående gammel, når listen blev hentet igen
 * efter en rettelse i modalen, en anden fane eller extensionen (audit A5,
 * P1-3). Her vises serverværdien, medmindre der er sat en optimistisk værdi;
 * den slettes så snart serverværdien ændrer sig (refetch efter gem, eller en
 * ændring udefra).
 */
export interface ServerValueState<T> {
  server: T;
  override: T | null;
}

/** Ren overgang: ny serverværdi rydder den optimistiske overstyring. */
export function nextServerValueState<T>(
  state: ServerValueState<T>,
  incoming: T,
): ServerValueState<T> {
  if (Object.is(state.server, incoming)) return state;
  return { server: incoming, override: null };
}

export function shownServerValue<T>(state: ServerValueState<T>): T {
  return state.override ?? state.server;
}

export function useServerValue<T>(
  serverValue: T,
): [shown: T, setOptimistic: (value: T | null) => void] {
  const [state, setState] = useState<ServerValueState<T>>({
    server: serverValue,
    override: null,
  });
  // "Justér state når en prop ændrer sig" under render (React-mønstret) —
  // undgår et glimt af den gamle værdi, som en useEffect ville give.
  const next = nextServerValueState(state, serverValue);
  if (next !== state) setState(next);
  const setOptimistic = (value: T | null) =>
    setState((s) => ({ ...s, override: value }));
  return [shownServerValue(next), setOptimistic];
}
