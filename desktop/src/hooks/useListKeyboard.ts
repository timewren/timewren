import { useCallback, useEffect, useRef, useState } from "react";

export interface ListKeyboardOptions {
  /** Total number of items in the list */
  itemCount: number;
  /** Called when Enter is pressed on the active item */
  onSelect?: (index: number) => void;
  /** Called when 'e' is pressed on the active item */
  onEdit?: (index: number) => void;
  /** Called when 'd' is pressed on the active item (after confirm) */
  onDelete?: (index: number) => void;
  /** Called when Space is pressed on the active item */
  onApprove?: (index: number) => void;
  /**
   * Called for ArrowLeft/ArrowRight. Only wired up when given, so a list that
   * wants the horizontal arrows for something else (moving between days, say)
   * can claim them without the hook swallowing the key first.
   */
  onHorizontal?: (delta: -1 | 1) => void;
  /** Whether the hook is active (default true) */
  enabled?: boolean;
}

export interface ListKeyboardResult {
  /** Currently highlighted item index (-1 = none) */
  activeIndex: number;
  /** Set the active index manually */
  setActiveIndex: (index: number) => void;
  /** Whether we are awaiting delete confirmation */
  pendingDeleteIndex: number | null;
  /** Confirm the pending delete */
  confirmDelete: () => void;
  /** Cancel the pending delete */
  cancelDelete: () => void;
}

/**
 * Hook that makes a list navigable with keyboard shortcuts.
 *
 * - j/k or ArrowDown/ArrowUp: navigate down/up
 * - Enter: select active item
 * - e: edit active item
 * - d: delete active item (with confirmation)
 * - Space: approve active item (e.g. in timeline)
 * - Escape: deselect / cancel delete
 */
export function useListKeyboard(
  options: ListKeyboardOptions,
): ListKeyboardResult {
  const {
    itemCount,
    onSelect,
    onEdit,
    onDelete,
    onApprove,
    onHorizontal,
    enabled = true,
  } = options;

  const [activeIndex, setActiveIndex] = useState(-1);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(
    null,
  );

  // Keep refs for callbacks so we don't re-register the listener on every render
  const onSelectRef = useRef(onSelect);
  const onEditRef = useRef(onEdit);
  const onDeleteRef = useRef(onDelete);
  const onApproveRef = useRef(onApprove);
  const onHorizontalRef = useRef(onHorizontal);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);
  useEffect(() => {
    onDeleteRef.current = onDelete;
  }, [onDelete]);
  useEffect(() => {
    onApproveRef.current = onApprove;
  }, [onApprove]);
  useEffect(() => {
    onHorizontalRef.current = onHorizontal;
  }, [onHorizontal]);

  // Reset active index when item count changes
  useEffect(() => {
    setActiveIndex((prev) => {
      if (prev >= itemCount) return itemCount - 1;
      return prev;
    });
  }, [itemCount]);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteIndex !== null && onDeleteRef.current) {
      onDeleteRef.current(pendingDeleteIndex);
      setPendingDeleteIndex(null);
    }
  }, [pendingDeleteIndex]);

  const cancelDelete = useCallback(() => {
    setPendingDeleteIndex(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;

      // Don't capture when typing in inputs/textareas
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't capture when Ctrl/Meta is held (those are global shortcuts)
      if (e.ctrlKey || e.metaKey) return;

      // Horizontal arrows belong to the caller (moving between days), and must
      // keep working on an empty list — the user still wants to move on.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (onHorizontalRef.current) {
          e.preventDefault();
          onHorizontalRef.current(e.key === "ArrowLeft" ? -1 : 1);
        }
        return;
      }

      // Nothing to highlight, select, edit or delete in an empty list.
      if (itemCount === 0) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev + 1;
            return next >= itemCount ? itemCount - 1 : next;
          });
          setPendingDeleteIndex(null);
          break;

        case "k":
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev - 1;
            return next < 0 ? 0 : next;
          });
          setPendingDeleteIndex(null);
          break;

        case "Enter":
          e.preventDefault();
          setActiveIndex((current) => {
            if (current >= 0 && onSelectRef.current) {
              onSelectRef.current(current);
            }
            return current;
          });
          break;

        case "e":
          e.preventDefault();
          setActiveIndex((current) => {
            if (current >= 0 && onEditRef.current) {
              onEditRef.current(current);
            }
            return current;
          });
          break;

        case "d":
          e.preventDefault();
          setActiveIndex((current) => {
            if (current >= 0) {
              setPendingDeleteIndex((pending) => {
                if (pending === current && onDeleteRef.current) {
                  // Second press = confirm
                  onDeleteRef.current(current);
                  return null;
                }
                // First press = ask for confirmation
                return current;
              });
            }
            return current;
          });
          break;

        case " ":
          e.preventDefault();
          setActiveIndex((current) => {
            if (current >= 0 && onApproveRef.current) {
              onApproveRef.current(current);
            }
            return current;
          });
          break;

        case "Escape":
          e.preventDefault();
          setPendingDeleteIndex((pending) => {
            if (pending !== null) return null;
            setActiveIndex(-1);
            return null;
          });
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, itemCount]);

  return {
    activeIndex,
    setActiveIndex,
    pendingDeleteIndex,
    confirmDelete,
    cancelDelete,
  };
}
