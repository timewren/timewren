import { create } from "zustand";
import type { QuickEntryDraft } from "../lib/quick-entry-draft";

interface QuickEntryStore {
  /** Udkast der venter på at blive vist i Hurtig registrering. */
  draft: QuickEntryDraft | null;
  openDraft: (draft: QuickEntryDraft) => void;
  takeDraft: () => QuickEntryDraft | null;
}

/** Åbner Hurtig registrering forudfyldt fra en anden fane/komponent. */
export const useQuickEntryStore = create<QuickEntryStore>((set, get) => ({
  draft: null,
  openDraft: (draft) => set({ draft }),
  takeDraft: () => {
    const { draft } = get();
    if (draft) set({ draft: null });
    return draft;
  },
}));
