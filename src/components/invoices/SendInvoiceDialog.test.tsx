// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";
import { SendInvoiceDialog } from "./SendInvoiceDialog";

const messages = await loadMessages("da");

const mocks = vi.hoisted(() => ({
  preview: {} as Record<string, unknown>,
  onSend: vi.fn(),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    invoices: {
      sendPreview: {
        useQuery: () => ({
          data: mocks.preview,
          isError: false,
          isFetching: false,
        }),
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
  mocks.onSend.mockResolvedValue(undefined);
  mocks.preview = {
    invoiceNumber: "1042",
    status: "draft",
    clientName: "Testkunde",
    email: "kunde@example.test",
    lineCount: 3,
    uncertainProviderEmail: null,
    total: 1250,
    showVat: true,
    currency: "DKK",
    dueDate: "2026-12-01",
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="da" messages={messages}>
        <SendInvoiceDialog
          invoiceId="invoice"
          onClose={() => {}}
          onSend={mocks.onSend}
        />
      </NextIntlClientProvider>,
    ),
  );
  const confirm = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Send til kunde@example.test",
  );
  return { dialog: document.querySelector('[role="dialog"]'), confirm };
}

it("shows the line count and sends what the user saw", async () => {
  const { dialog, confirm } = await render();
  expect(dialog?.textContent).toContain("Linjer3");
  await act(async () => confirm?.click());
  expect(mocks.onSend).toHaveBeenCalledExactlyOnceWith("kunde@example.test", {
    invoiceNumber: "1042",
    total: 1250,
    currency: "DKK",
    lineCount: 3,
    recipient: "kunde@example.test",
  });
});

it("blocks sending while a Billy mail result is uncertain", async () => {
  mocks.preview.uncertainProviderEmail = "billy";
  const { dialog, confirm } = await render();
  expect(dialog?.querySelector('[role="alert"]')?.textContent).toBe(
    "Billy svarede ikke, om fakturaen blev mailet. Tjek mailstatus i Billy, og markér resultatet på fakturasiden, før du sender den igen.",
  );
  expect(confirm?.disabled).toBe(true);
  await act(async () => confirm?.click());
  expect(mocks.onSend).not.toHaveBeenCalled();
});
