import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
    },
  },
});

const { seedProjectsCache } = await import("./projects-cache");

beforeEach(() => {
  storage.clear();
  storage.set("selectedOrgId", "org1");
  storage.set("cachedClients", [{ id: "c1", name: "Kunde" }]);
  storage.set("cachedProjects", [{ id: "p1", name: "Projekt" }]);
  storage.set("cachedClientsAt", 1000);
  storage.set("cachedClientsOrgId", "org1");
});

describe("baggrundens cache som startdata (#C4)", () => {
  it("lægger cachen for den valgte organisation i query-cachen", async () => {
    const client = new QueryClient();
    await seedProjectsCache(client);
    const key = ["projectsAndClients", "org1"];
    expect(client.getQueryData(key)).toEqual({
      clients: [{ id: "c1", name: "Kunde" }],
      projects: [{ id: "p1", name: "Projekt" }],
    });
    // Vises straks, men hentes altid frisk (forældet fra start)
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(0);
  });

  it("bruger ikke en anden organisations cache", async () => {
    storage.set("cachedClientsOrgId", "org2");
    const client = new QueryClient();
    await seedProjectsCache(client);
    expect(client.getQueryData(["projectsAndClients", "org1"])).toBeUndefined();
  });
});
