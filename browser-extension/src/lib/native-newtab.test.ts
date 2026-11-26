import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHROME_NEW_TAB_URL,
  isNewTabDisabled,
  latestOnly,
  nativeNewTabUrl,
  openNativeNewTab,
  searchInCurrentTab,
} from "./native-newtab";

const storage = new Map<string, unknown>();
const tabs = {
  getCurrent: vi.fn(),
  update: vi.fn(),
};
const search = { query: vi.fn() };
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
    },
  },
  tabs,
  search,
});

const brands = (...names: string[]) => ({
  userAgentData: { brands: names.map((brand) => ({ brand, version: "158" })) },
});
const CHROME = brands("Chromium", "Not.A/Brand", "Google Chrome");

beforeEach(() => {
  storage.clear();
  tabs.getCurrent.mockReset().mockResolvedValue({ id: 7 });
  tabs.update.mockReset().mockResolvedValue({ id: 7 });
  search.query.mockReset().mockResolvedValue(undefined);
});

describe("nativeNewTabUrl", () => {
  it("peger på Chromes egen nye fane i Google Chrome", () => {
    expect(nativeNewTabUrl(CHROME)).toBe(CHROME_NEW_TAB_URL);
  });

  it("giver ingen adresse i Edge, Brave, Opera og Firefox", () => {
    // Edges egen nye fane (edge://newtab) er selv overtaget af udvidelsen, og
    // de andre har ingen chrome://new-tab-page/; de får søgesiden i stedet.
    expect(nativeNewTabUrl(brands("Microsoft Edge", "Chromium"))).toBeNull();
    expect(nativeNewTabUrl(brands("Brave", "Chromium"))).toBeNull();
    expect(nativeNewTabUrl(brands("Opera", "Chromium"))).toBeNull();
    expect(nativeNewTabUrl({})).toBeNull();
  });
});

describe("isNewTabDisabled", () => {
  it("er slået til, når intet er gemt", async () => {
    expect(await isNewTabDisabled()).toBe(false);
  });

  it("læser indstillingen fra lageret", async () => {
    storage.set("extensionSettings", { newTabEnabled: false });
    expect(await isNewTabDisabled()).toBe(true);
    storage.set("extensionSettings", { newTabEnabled: true });
    expect(await isNewTabDisabled()).toBe(false);
  });
});

describe("openNativeNewTab", () => {
  it("sender den aktuelle fane til Chromes nye fane", async () => {
    expect(await openNativeNewTab(CHROME)).toBe(true);
    expect(tabs.update).toHaveBeenCalledWith(7, { url: CHROME_NEW_TAB_URL });
  });

  it("gør intet uden for Chrome", async () => {
    expect(await openNativeNewTab(brands("Microsoft Edge"))).toBe(false);
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it("melder fejl, når fanen ikke kan skifte, så siden selv kan vises", async () => {
    tabs.update.mockRejectedValue(new Error("Cannot navigate"));
    expect(await openNativeNewTab(CHROME)).toBe(false);
    tabs.getCurrent.mockResolvedValue(undefined);
    expect(await openNativeNewTab(CHROME)).toBe(false);
  });
});

describe("searchInCurrentTab", () => {
  it("søger i netop denne fane via dens id, ikke den aktive fane", async () => {
    // Firefox binder CURRENT_TAB til den fane, der er aktiv, når søgetjenesten
    // svarer; har brugeren skiftet fane imens, ville den blive overskrevet.
    expect(await searchInCurrentTab("vejret")).toBe(true);
    expect(search.query).toHaveBeenCalledWith({ text: "vejret", tabId: 7 });
  });

  it("søger ikke, når fanens id ikke kan findes", async () => {
    // CURRENT_TAB kunne i Firefox ramme en anden fane; hellere fejlbeskeden,
    // så brugeren søger i adresselinjen.
    tabs.getCurrent.mockResolvedValue(undefined);
    expect(await searchInCurrentTab("vejret")).toBe(false);
    expect(search.query).not.toHaveBeenCalled();
  });

  it("melder fejl, når browseren afviser søgningen", async () => {
    // Fx "Missing default search provider", når en politik slår søgning fra.
    search.query.mockRejectedValue(
      new Error("Missing default search provider"),
    );
    expect(await searchInCurrentTab("vejret")).toBe(false);
  });
});

describe("latestOnly", () => {
  it("lader kun den seneste indsendelse sætte resultatet", () => {
    const latest = latestOnly();
    const first = latest.next();
    const second = latest.next();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("glemmer en indsendelse, når brugeren skriver igen", () => {
    // Et sent afslag må ikke vise fejlbeskeden igen over en ny søgning.
    const latest = latestOnly();
    const pending = latest.next();
    latest.cancel();
    expect(pending()).toBe(false);
  });
});
