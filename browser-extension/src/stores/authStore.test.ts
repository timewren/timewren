import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
      remove: async (keys: string[]) => {
        for (const k of keys) storage.delete(k);
      },
    },
    onChanged: { addListener: () => {} },
  },
});

const api = vi.hoisted(() => ({
  validateToken: vi.fn(),
  listOrganizations: vi.fn(),
}));
vi.mock("../api/client", () => ({ apiClient: api }));

const { useAuthStore } = await import("./authStore");

const USER = { id: "u1", name: "Mads", email: "x", defaultHourlyRate: null };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage.clear();
  api.validateToken.mockReset();
  api.listOrganizations.mockReset();
  useAuthStore.setState({
    token: null,
    user: null,
    isAuthenticated: false,
    isLoading: true,
    orgsLoaded: false,
    selectedOrgId: null,
  });
});

describe("opstart af popup og ny fane (#C4)", () => {
  it("viser UI'et ud fra storage, før tokenet er valideret", async () => {
    storage.set("extensionToken", "tok");
    storage.set("selectedOrgId", "org1");
    storage.set("cachedUser", USER);
    api.validateToken.mockReturnValue(new Promise(() => {}));
    api.listOrganizations.mockReturnValue(new Promise(() => {}));

    void useAuthStore.getState().checkAuth();
    await flush();

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.isAuthenticated).toBe(true);
    expect(state.orgsLoaded).toBe(true);
    expect(state.selectedOrgId).toBe("org1");
    expect(state.user?.name).toBe("Mads");
    // Validering og organisationer kører samtidig
    expect(api.validateToken).toHaveBeenCalled();
    expect(api.listOrganizations).toHaveBeenCalled();
  });

  it("et afvist token logger ud bagefter", async () => {
    storage.set("extensionToken", "tok");
    api.validateToken.mockResolvedValue({ valid: false, user: null });
    api.listOrganizations.mockRejectedValue(new Error("401"));
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().error).toBe(
      "Din session er udløbet. Log ind igen.",
    );
    expect(storage.has("extensionToken")).toBe(false);
    // Storage-lytteren (andre visninger) skal også vise beskeden
    expect(storage.get("sessionExpired")).toBe(true);
  });

  it("uden net forbliver brugeren logget ind", async () => {
    storage.set("extensionToken", "tok");
    api.validateToken.mockRejectedValue(new TypeError("Failed to fetch"));
    api.listOrganizations.mockRejectedValue(new TypeError("Failed to fetch"));
    await useAuthStore.getState().checkAuth();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.orgsLoaded).toBe(true);
    expect(storage.get("extensionToken")).toBe("tok");
  });
});
