// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  // Som en refetch efter gem: profilen er det, der sidst blev gemt
  save: vi.fn(async (input: Record<string, unknown>) => {
    mocks.profile = { ...mocks.profile, ...input };
    return mocks.profile;
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/dashboard-nav", () => ({ PageHeader: () => null }));
vi.mock("@/components/settings/AdminOnlyNotice", () => ({
  AdminOnlyNotice: () => null,
  useCanManageOrgSettings: () => true,
}));
vi.mock("@/components/settings/DayOffCalendarEditor", () => ({
  DayOffCalendarEditor: () => null,
}));
vi.mock("@/components/ui/AutoSaveStatus", () => ({
  AutoSaveStatus: () => null,
}));
vi.mock("@/components/ui/ImageUpload", () => ({ ImageUpload: () => null }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { email: "firma@moms.test" } },
    isPending: false,
  }),
}));
vi.mock("@/providers/trpc-provider", () => {
  const cache = () => ({ invalidate: vi.fn() });
  return {
    trpc: {
      onboarding: {
        getCompanyProfile: {
          useQuery: () => ({ data: mocks.profile, isLoading: false }),
        },
        updateCompanyProfile: {
          useMutation: () => ({ mutateAsync: mocks.save }),
        },
      },
      user: {
        getProfile: { useQuery: () => ({ data: undefined }) },
        updateCompanyInfo: {
          useMutation: () => ({ mutateAsync: async () => undefined }),
        },
      },
      useUtils: () => ({
        onboarding: { getCompanyProfile: cache() },
        user: { getProfile: cache(), getUpcomingDeadlines: cache() },
      }),
    },
  };
});

import CompanySettingsPage from "./page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const baseProfile = {
  name: "Moms ApS",
  email: "firma@moms.test",
  cvrNumber: "",
  country: "Danmark",
  vatRegistered: false,
  vatRegisteredChosen: false,
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.save.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(profile: Partial<typeof baseProfile>) {
  mocks.profile = { ...baseProfile, ...profile };
  act(() => {
    root.render(<CompanySettingsPage />);
  });
}

const input = (id: string) =>
  container.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
const vatBox = () => input("vatRegistered");

/** Taster en værdi og forlader feltet, så autogem sender med det samme. */
async function typeAndSave(id: string, value: string) {
  const el = input(id);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const lastSaved = () => mocks.save.mock.calls.at(-1)?.[0];

describe("Virksomhedsindstillinger: momsfluebenet", () => {
  it("et nyt dansk CVR slår det til; valget overlades til serveren", async () => {
    render({});
    expect(vatBox().checked).toBe(false);
    await typeAndSave("cvrNumber", "12345678");
    expect(vatBox().checked).toBe(true);
    expect(lastSaved()).toMatchObject({ cvrNumber: "12345678" });
    expect(lastSaved()).not.toHaveProperty("vatRegistered");
    expect(lastSaved()).not.toHaveProperty("vatRegisteredChosen");
  });

  // Greptile P1 1
  it("gemt fravalg: slet et ciffer, autogem, tast det igen: stadig fra", async () => {
    render({
      cvrNumber: "12345678",
      vatRegistered: false,
      vatRegisteredChosen: true,
    });
    await typeAndSave("cvrNumber", "1234567");
    expect(lastSaved()).toMatchObject({
      cvrNumber: "1234567",
      vatRegistered: false,
    });
    await typeAndSave("cvrNumber", "12345678");
    expect(vatBox().checked).toBe(false);
    expect(lastSaved()).toMatchObject({
      cvrNumber: "12345678",
      vatRegistered: false,
    });
  });

  // Greptile P1 2
  it("Danmark skrevet om til Denmark: slået til igen", async () => {
    render({ cvrNumber: "12345678", vatRegistered: true });
    expect(vatBox().checked).toBe(true);
    await typeAndSave("companyCountry", "Den");
    expect(vatBox().checked).toBe(false);
    await typeAndSave("companyCountry", "Denmark");
    expect(vatBox().checked).toBe(true);
    expect(lastSaved()).not.toHaveProperty("vatRegistered");
  });

  it("brugerens klik er et valg og sendes", async () => {
    render({ cvrNumber: "12345678", vatRegistered: true });
    await act(async () => {
      vatBox().click();
    });
    expect(vatBox().checked).toBe(false);
    expect(lastSaved()).toMatchObject({ vatRegistered: false });
    await typeAndSave("companyCountry", "Den");
    await typeAndSave("companyCountry", "Denmark");
    expect(vatBox().checked).toBe(false);
    expect(lastSaved()).toMatchObject({ vatRegistered: false });
  });
});
