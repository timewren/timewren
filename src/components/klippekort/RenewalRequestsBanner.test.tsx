// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";
import { RenewalRequestsBanner } from "./RenewalRequestsBanner";

const messages = await loadMessages("da");
const banner = () => (
  <NextIntlClientProvider locale="da" messages={messages}>
    <RenewalRequestsBanner />
  </NextIntlClientProvider>
);

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  send: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  canWrite: true,
  moduleEnabled: true,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => mocks.moduleEnabled }),
}));
vi.mock("@/hooks/usePermission", () => ({
  usePermission: () => ({ canWrite: mocks.canWrite }),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    useUtils: () => ({
      prepaid: {
        invalidate: mocks.invalidate,
        listRenewalRequests: { invalidate: mocks.invalidate },
      },
      invoices: { invalidate: mocks.invalidate },
    }),
    prepaid: {
      listRenewalRequests: {
        useQuery: () => ({
          data: [
            {
              id: "request",
              client: { name: "Testkunde" },
              prepaidPackage: { name: "Timer" },
            },
          ],
        }),
      },
      resolveRenewalRequest: {
        useMutation: () => ({ mutateAsync: mocks.resolve, isPending: false }),
      },
    },
    invoices: {
      sendPreview: {
        useQuery: () => ({
          data: {
            invoiceNumber: "UDKAST-123",
            status: "draft",
            clientName: "Testkunde",
            email: "kunde@example.test",
            total: 1250,
            currency: "DKK",
            lineCount: 3,
            uncertainProviderEmail: null,
            dueDate: new Date("2026-12-01T00:00:00Z"),
          },
        }),
      },
      sendEmail: {
        useMutation: () => ({ mutateAsync: mocks.send, isPending: false }),
      },
    },
  },
}));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.canWrite = true;
  mocks.moduleEnabled = true;
  mocks.resolve.mockResolvedValue({ approved: true, invoiceId: "invoice" });
  mocks.send.mockResolvedValue({ success: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function click(label: string) {
  await act(async () => root.render(banner()));
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
it("sends the renewed invoice only after the recipient is confirmed", async () => {
  await click("Godkend og gennemgå afsendelse");
  expect(mocks.resolve).toHaveBeenCalledWith({
    requestId: "request",
    approve: true,
  });
  expect(mocks.send).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Testkunde");
  expect(dialog?.textContent).toContain("UDKAST-123");
  expect(dialog?.textContent).toContain("1.250,00");
  expect(dialog?.textContent).toContain("01.12.2026");
  await click("Send til kunde@example.test");
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
    id: "invoice",
    expectedRecipient: "kunde@example.test",
    expectedInvoice: {
      invoiceNumber: "UDKAST-123",
      total: 1250,
      currency: "DKK",
      lineCount: 3,
      recipient: "kunde@example.test",
    },
  });
  expect(mocks.success).toHaveBeenCalledWith(
    "Faktura sendt til kunde@example.test",
  );
});

it("leaves the renewed invoice as a draft when confirmation is cancelled", async () => {
  await click("Godkend og gennemgå afsendelse");
  await click("Annuller");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledWith("Fornyet. Fakturakladde oprettet");
});

it("offers no sending when invoicing is disabled but keeps approval", async () => {
  mocks.moduleEnabled = false;
  await act(async () => root.render(banner()));
  expect(container.textContent).not.toContain("Godkend og gennemgå afsendelse");
  expect(container.textContent).toContain("Godkend + fakturakladde");
  expect(container.textContent).toContain("Afvis");
});
it("keeps draft approval without sending", async () => {
  await click("Godkend + fakturakladde");
  expect(mocks.resolve).toHaveBeenCalledWith({
    requestId: "request",
    approve: true,
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledWith("Fornyet. Fakturakladde oprettet");
});
it("declines without sending an invoice", async () => {
  mocks.resolve.mockResolvedValueOnce({ approved: false, invoiceId: null });
  await click("Afvis");
  expect(mocks.resolve).toHaveBeenCalledWith({
    requestId: "request",
    approve: false,
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledWith("Afvist");
});
it("blocks duplicate approval throughout sending", async () => {
  let finish!: () => void;
  mocks.send.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await click("Godkend og gennemgå afsendelse");
  await click("Send til kunde@example.test");
  expect(
    [...container.querySelectorAll("button")].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  await click("Godkend + fakturakladde");
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.success).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(
    [...container.querySelectorAll("button")].every(
      (button) => !button.disabled,
    ),
  ).toBe(true);
});
it("does not send when approval fails", async () => {
  mocks.resolve.mockRejectedValueOnce(new Error("Afvist"));
  await click("Godkend og gennemgå afsendelse");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("Afvist");
});
it("links to the existing invoice after a send failure without repeating renewal", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Mailfejl"));
  await click("Godkend og gennemgå afsendelse");
  await click("Send til kunde@example.test");
  expect(
    container.querySelector('a[href="/dashboard/invoices/invoice"]'),
  ).not.toBeNull();
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.success).not.toHaveBeenCalled();
});
it("does not send or claim a draft exists when renewal creates no invoice", async () => {
  mocks.resolve.mockResolvedValueOnce({ approved: true, invoiceId: null });
  await click("Godkend og gennemgå afsendelse");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.success).toHaveBeenCalledWith("Fornyet. Ingen faktura oprettet");
});
it("hides immediate sending without invoice write access", async () => {
  mocks.canWrite = false;
  await act(async () => root.render(banner()));
  expect(container.textContent).not.toContain("Godkend og gennemgå afsendelse");
});
