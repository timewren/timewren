import { create } from "zustand";
import { siteFromTab } from "../utils/siteCategory";

export interface SiteMapping {
  domain: string;
  projectId: string;
  clientId: string;
  usageCount: number;
  lastUsed: string;
}

export interface CurrentSite {
  url: string;
  domain: string;
  title: string;
  favicon: string | null;
  category?: string;
  isWorkRelated?: boolean;
  confidence?: number;
}

interface SiteState {
  currentSite: CurrentSite | null;
  mappings: SiteMapping[];
  /** Domains where the user dismissed suggestions 3+ times */
  dismissedDomains: string[];
  /** Skjult med X i denne popup — forslaget forsvinder ved første klik */
  hiddenThisSession: string[];
  suggestedProjectId: string | null;

  setCurrentSite: (site: CurrentSite | null) => void;
  /** Læs den aktive fane (activeTab) én gang pr. åbning af popup'en. */
  detectCurrentSite: () => Promise<void>;
  addMapping: (domain: string, projectId: string, clientId: string) => void;
  /** Track that user dismissed suggestion for this domain */
  dismissSuggestion: (domain: string) => void;
  /** Skjult i denne popup eller afvist 3+ gange */
  isDismissed: (domain: string) => boolean;
  getSuggestion: (domain: string) => SiteMapping | null;
  loadMappings: () => Promise<void>;
  saveMappings: () => Promise<void>;
}

export const useSiteStore = create<SiteState>((set, get) => ({
  currentSite: null,
  mappings: [],
  dismissedDomains: [],
  hiddenThisSession: [],
  suggestedProjectId: null,

  setCurrentSite: (site) => {
    set({ currentSite: site });

    // Update suggestion based on domain
    if (site) {
      const suggestion = get().getSuggestion(site.domain);
      set({ suggestedProjectId: suggestion?.projectId || null });
    } else {
      set({ suggestedProjectId: null });
    }
  },

  detectCurrentSite: async () => {
    // Koblingerne først, så forslaget ud fra domænet kan findes med det samme
    await get().loadMappings();
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      get().setCurrentSite(tab ? siteFromTab(tab) : null);
    } catch {
      get().setCurrentSite(null);
    }
  },

  addMapping: (domain, projectId, clientId) => {
    const { mappings } = get();
    const existing = mappings.find((m) => m.domain === domain);

    if (existing) {
      // Update existing mapping
      const updated = mappings.map((m) =>
        m.domain === domain
          ? {
              ...m,
              projectId,
              clientId,
              usageCount: m.usageCount + 1,
              lastUsed: new Date().toISOString(),
            }
          : m,
      );
      set({ mappings: updated });
    } else {
      // Add new mapping
      set({
        mappings: [
          ...mappings,
          {
            domain,
            projectId,
            clientId,
            usageCount: 1,
            lastUsed: new Date().toISOString(),
          },
        ],
      });
    }

    get().saveMappings();
  },

  getSuggestion: (domain) => {
    const { mappings } = get();

    // Find exact match
    const exactMatch = mappings.find((m) => m.domain === domain);
    if (exactMatch) return exactMatch;

    // Try parent domain (e.g., app.example.com -> example.com)
    const parts = domain.split(".");
    if (parts.length > 2) {
      const parentDomain = parts.slice(-2).join(".");
      const parentMatch = mappings.find((m) => m.domain === parentDomain);
      if (parentMatch) return parentMatch;
    }

    return null;
  },

  dismissSuggestion: (domain) => {
    // Skjul med det samme. Tælleren bevares: efter 3 gange på samme domæne
    // kommer det på den permanente skip-liste ("skjul altid").
    const { hiddenThisSession } = get();
    if (!hiddenThisSession.includes(domain)) {
      set({ hiddenThisSession: [...hiddenThisSession, domain] });
    }
    // Track dismissal count in chrome.storage. After 3 dismissals for
    // the same domain, add it to the permanent skip list.
    chrome.storage.local.get(["siteDismissals"]).then((result) => {
      const dismissals = (result.siteDismissals ?? {}) as Record<
        string,
        number
      >;
      const count = (dismissals[domain] ?? 0) + 1;
      dismissals[domain] = count;
      chrome.storage.local.set({ siteDismissals: dismissals });

      if (count >= 3) {
        const { dismissedDomains } = get();
        if (!dismissedDomains.includes(domain)) {
          const updated = [...dismissedDomains, domain];
          set({ dismissedDomains: updated });
          chrome.storage.local.set({ dismissedDomains: updated });
        }
      }
    });
  },

  isDismissed: (domain) => {
    const { dismissedDomains, hiddenThisSession } = get();
    return (
      dismissedDomains.includes(domain) || hiddenThisSession.includes(domain)
    );
  },

  loadMappings: async () => {
    try {
      const result = await chrome.storage.local.get([
        "siteMappings",
        "dismissedDomains",
      ]);
      if (Array.isArray(result.siteMappings)) {
        set({ mappings: result.siteMappings as SiteMapping[] });
      }
      if (Array.isArray(result.dismissedDomains)) {
        set({ dismissedDomains: result.dismissedDomains as string[] });
      }
    } catch (error) {
      console.error("Failed to load site mappings:", error);
    }
  },

  saveMappings: async () => {
    try {
      const { mappings } = get();
      await chrome.storage.local.set({ siteMappings: mappings });
    } catch (error) {
      console.error("Failed to save site mappings:", error);
    }
  },
}));
