// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import billing from "@/i18n/messages/da/billing.json";
import common from "@/i18n/messages/da/common.json";
import invoices from "@/i18n/messages/da/invoices.json";

/**
 * "Fakturér nu" er en interaktiv web-vej til den første faktura og skal derfor
 * bede om virksomhedskravet og vise vejen til oplysningerne, når serveren
 * afviser, i stedet for en fejl-toast.
 */

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
  onError: null as null | ((error: unknown) => void),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    invoices: {
      previewFromTimeEntries: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: {
            clientName: "Kunde A/S",
            entryCount: 1,
            entryIds: ["e1"],
            totalHours: 2,
            totalAmount: 1700,
            hoursWithoutRate: 0,
            firstDate: "2026-11-02",
            lastDate: "2026-11-02",
            groups: [
              {
                key: "p1",
                label: "Projekt",
                entryCount: 1,
                hours: 2,
                amount: 1700,
              },
            ],
          },
        }),
      },
      generateFromTimeEntries: {
        useMutation: (opts: { onError: (error: unknown) => void }) => {
          mocks.onError = opts.onError;
          return { mutate: mocks.mutate, isPending: false };
        },
      },
    },
  },
}));

import { InvoiceNowDialog } from "../InvoiceNowDialog";

afterEach(() => {
  document.body.innerHTML = "";
  mocks.mutate.mockReset();
  mocks.toastError.mockReset();
});

async function renderDialog() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="da"
        messages={{ billing, common, invoices }}
        onError={() => {}}
      >
        <InvoiceNowDialog
          clientId="c1"
          isOpen
          onClose={vi.fn()}
          origin="client_page"
        />
      </NextIntlClientProvider>,
    );
  });
  return container;
}

function createButton(container: HTMLElement) {
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Opret fakturakladde"),
  );
  if (!button) throw new Error("Opret fakturakladde-knappen mangler");
  return button;
}

describe("InvoiceNowDialog", () => {
  it("beder om virksomhedskravet for den første faktura", async () => {
    const container = await renderDialog();
    await act(async () => createButton(container).click());
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ requireCompanyProfile: true }),
    );
  });

  it("viser vejen til virksomhedsoplysningerne, når serveren afviser", async () => {
    const container = await renderDialog();
    await act(async () =>
      mocks.onError?.({
        message: "Udfyld dine virksomhedsoplysninger",
        data: { code: "BAD_REQUEST", appCode: "COMPANY_PROFILE_REQUIRED" },
      }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        'a[href="/dashboard/settings/company?from=invoices"]',
      ),
    ).not.toBeNull();
    expect(createButton(container).disabled).toBe(true);
  });

  it("viser andre fejl som en toast", async () => {
    const container = await renderDialog();
    await act(async () =>
      mocks.onError?.({
        message: "Noget gik galt",
        data: { code: "BAD_REQUEST" },
      }),
    );
    expect(mocks.toastError).toHaveBeenCalledWith("Noget gik galt");
    expect(
      container.querySelector('a[href^="/dashboard/settings/company"]'),
    ).toBeNull();
  });
});
