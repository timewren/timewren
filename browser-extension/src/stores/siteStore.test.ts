import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
let activeTab: Record<string, string> | undefined;
vi.stubGlobal("chrome", {
  tabs: {
    query: async () => (activeTab ? [activeTab] : []),
  },
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
    },
  },
});

const { useSiteStore } = await import("./siteStore");

beforeEach(() => {
  storage.clear();
  useSiteStore.setState({ dismissedDomains: [], hiddenThisSession: [] });
});

describe("site-forslag (#17)", () => {
  it("første klik på X skjuler forslaget med det samme", () => {
    useSiteStore.getState().dismissSuggestion("kunde.dk");
    expect(useSiteStore.getState().isDismissed("kunde.dk")).toBe(true);
    expect(useSiteStore.getState().isDismissed("andet.dk")).toBe(false);
  });

  it("tredje gang kommer domænet på den permanente liste", async () => {
    for (let i = 0; i < 3; i++) {
      useSiteStore.getState().dismissSuggestion("kunde.dk");
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(useSiteStore.getState().dismissedDomains).toEqual(["kunde.dk"]);
    expect(storage.get("dismissedDomains")).toEqual(["kunde.dk"]);
  });
});

describe("aktivt websted (#C1)", () => {
  it("læser fanen og finder koblingen, også før koblingerne er indlæst", async () => {
    storage.set("siteMappings", [
      {
        domain: "kunde.dk",
        projectId: "p1",
        clientId: "c1",
        usageCount: 1,
        lastUsed: "2026-10-26T08:00:00.000Z",
      },
    ]);
    useSiteStore.setState({ mappings: [] });
    activeTab = { url: "https://app.kunde.dk/x", title: "Kunde" };
    await useSiteStore.getState().detectCurrentSite();
    expect(useSiteStore.getState().currentSite?.domain).toBe("app.kunde.dk");
    expect(useSiteStore.getState().suggestedProjectId).toBe("p1");
  });

  it("ingen fane med http giver intet websted", async () => {
    activeTab = { url: "chrome://newtab/" };
    await useSiteStore.getState().detectCurrentSite();
    expect(useSiteStore.getState().currentSite).toBeNull();
  });
});
