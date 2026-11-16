import { useCallback, useEffect, useState } from "react";

interface UseFormDraftOptions<T> {
  key: string;
  initialValues: T;
  debounceMs?: number;
}

interface UseFormDraftReturn<T> {
  values: T;
  setValues: (values: T | ((prev: T) => T)) => void;
  hasDraft: boolean;
  clearDraft: () => void;
  restoreDraft: () => void;
  isDraftRestored: boolean;
}

/**
 * Hook for auto-saving form drafts to localStorage with restore functionality.
 * Automatically saves form values on change with debouncing.
 *
 * @param key - Unique localStorage key for this form
 * @param initialValues - Default/initial form values
 * @param debounceMs - Debounce delay for saving (default: 500ms)
 */
export function useFormDraft<T extends object>({
  key,
  initialValues,
  debounceMs = 500,
}: UseFormDraftOptions<T>): UseFormDraftReturn<T> {
  const storageKey = `form-draft-${key}`;
  const [values, setValuesInternal] = useState<T>(initialValues);
  const [hasDraft, setHasDraft] = useState(false);
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  // Check for existing draft on mount
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(storageKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        // Check if draft has any non-empty values
        const hasContent = Object.values(parsed).some(
          (v) => v !== "" && v !== null && v !== undefined,
        );
        setHasDraft(hasContent);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [storageKey]);

  // Debounced save to localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // Only save if there's content
        const hasContent = Object.values(values).some(
          (v) => v !== "" && v !== null && v !== undefined,
        );
        if (hasContent) {
          localStorage.setItem(storageKey, JSON.stringify(values));
          setHasDraft(true);
        }
      } catch {
        // Ignore localStorage errors
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [values, storageKey, debounceMs]);

  const setValues = useCallback((newValues: T | ((prev: T) => T)) => {
    setValuesInternal(newValues);
    setIsDraftRestored(false);
  }, []);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      setHasDraft(false);
      setIsDraftRestored(false);
    } catch {
      // Ignore localStorage errors
    }
  }, [storageKey]);

  const restoreDraft = useCallback(() => {
    try {
      const savedDraft = localStorage.getItem(storageKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as T;
        setValuesInternal(parsed);
        setIsDraftRestored(true);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [storageKey]);

  return {
    values,
    setValues,
    hasDraft,
    clearDraft,
    restoreDraft,
    isDraftRestored,
  };
}

/**
 * Simpler hook for single-value draft storage
 */
export function useFieldDraft<T>(
  key: string,
  initialValue: T,
): [T, (value: T) => void, () => void] {
  const storageKey = `field-draft-${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved) as T;
      }
    } catch {
      // Ignore
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      if (value !== initialValue) {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }
    } catch {
      // Ignore
    }
  }, [value, storageKey, initialValue]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      setValue(initialValue);
    } catch {
      // Ignore
    }
  }, [storageKey, initialValue]);

  return [value, setValue, clear];
}
