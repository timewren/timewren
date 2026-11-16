import type { EntryFormState, FormErrorKey } from './form-state';
import * as React from 'react';

export type FormError = { key: FormErrorKey; field: string } | null;

/** Fælles form-state-håndtering for ny/redigér. */
export function useEntryFormState(initial: EntryFormState) {
  const [state, setState] = React.useState(initial);
  const [error, setError] = React.useState<FormError>(null);
  const onChange = React.useCallback((patch: Partial<EntryFormState>) => {
    setState(s => ({ ...s, ...patch }));
    setError(null);
  }, []);
  return { state, setState, error, setError, onChange };
}
