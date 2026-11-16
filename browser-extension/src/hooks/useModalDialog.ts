import { useEffect, useRef } from "react";
import {
  activeDialogIndex,
  FOCUSABLE_SELECTOR,
  trapTabTarget,
} from "../lib/focus-trap";

interface OpenDialog {
  id: symbol;
  modal: boolean;
  contains: (el: Element | null) => boolean;
}

// Åbne dialoger i rækkefølge. Den øverste, der gælder, reagerer på Esc og
// Tab, så en bekræftelse oven på en anden dialog ikke lukker begge. En
// ikke-modal boks (inline bekræftelse) gælder kun, når fokus står i den.
const openDialogs: OpenDialog[] = [];

/** Den øverste modale dialog ejer Tab-fælden, også når fokus står i en
 * inline bekræftelse inde i den. */
function topModal(): OpenDialog | undefined {
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    if (openDialogs[i].modal) return openDialogs[i];
  }
  return undefined;
}

function activeDialog(): OpenDialog | undefined {
  const focused = document.activeElement;
  const index = activeDialogIndex(
    openDialogs.map((d) => ({ modal: d.modal, hasFocus: d.contains(focused) })),
  );
  return openDialogs[index];
}

function focusables(root: HTMLElement): HTMLElement[] {
  // tabIndex -1 (fx valgmuligheder styret med aria-activedescendant) er
  // ikke i Tab-rækkefølgen og må ikke tælle som første eller sidste
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
}

/**
 * Dialog-adfærd (WCAG 2.1.2 og 2.4.3): fokus flyttes ind ved åbning
 * (elementet med `data-autofocus`, ellers det første fokuserbare), Esc
 * lukker, og fokus går tilbage til det element, der åbnede den. Sæt ref'en
 * på dialogens yderste element og giv det `tabIndex={-1}`.
 *
 * `modal` (standard): Tab holdes inde i dialogen, og Esc virker uanset hvor
 * fokus står. `modal: false` er til inline bekræftelser uden baggrund:
 * ingen fokusfælde, og Esc virker kun, når fokus står i boksen.
 *
 * Esc ignoreres, hvis et element i dialogen allerede har brugt tasten
 * (`preventDefault`), fx en åben dropdown.
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  open = true,
  { modal = true }: { modal?: boolean } = {},
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const entry: OpenDialog = {
      id: Symbol("dialog"),
      modal,
      contains: (el) => !!el && !!ref.current?.contains(el),
    };
    openDialogs.push(entry);
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const node = ref.current;
    if (node && !node.contains(document.activeElement)) {
      const target =
        node.querySelector<HTMLElement>("[data-autofocus]") ??
        focusables(node)[0] ??
        node;
      target.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented || activeDialog() !== entry) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || topModal() !== entry) return;
      const items = focusables(root);
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = trapTabTarget(items.length, index, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      (next === -1 ? root : items[next]).focus();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openDialogs.splice(openDialogs.indexOf(entry), 1);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, modal]);

  return ref;
}
