import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import InvoiceDetailPage from "@/app/(app)/dashboard/invoices/[id]/page";
import PackageDetailPage from "@/app/(app)/dashboard/klippekort/[id]/page";
import { loadMessages } from "@/i18n/messages/load";
import { demoCurrencyMessages } from "../currency-messages";

const { usageExport } = vi.hoisted(() => ({
  usageExport: vi.fn<(props: { pdfLanguage?: unknown }) => null>(() => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/hooks/usePermission", () => ({
  usePermission: () => ({ canWrite: false }),
}));
vi.mock("@/components/dashboard-nav", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/invoices/InvoiceLineEditor", () => ({
  InvoiceLineEditor: () => null,
}));
vi.mock("@/components/invoices/InvoicePDFViewer", () => ({
  InvoicePDFViewer: () => null,
}));
vi.mock("@/components/invoices/BillyExportModal", () => ({
  BillyExportModal: () => null,
}));
vi.mock("@/components/invoices/DineroExportModal", () => ({
  DineroExportModal: () => null,
}));
vi.mock("@/components/invoices/SendInvoiceDialog", () => ({
  SendInvoiceDialog: () => null,
}));
vi.mock("@/components/invoices/ProviderEmailUncertainBanner", () => ({
  ProviderEmailUncertainBanner: () => null,
}));
vi.mock("@/components/klippekort/AssignEntriesModal", () => ({
  AssignEntriesModal: () => null,
}));
vi.mock("@/components/klippekort/UsageExport", () => ({
  UsageExport: usageExport,
}));
vi.mock("@/providers/trpc-provider", () => {
  const mutation = { useMutation: () => ({}) };
  const emptyQuery = { useQuery: () => ({}) };
  return {
    trpc: {
      useUtils: () => ({}),
      invoices: {
        getById: {
          useQuery: () => ({
            data: {
              id: "invoice",
              invoiceNumber: "2026-001",
              status: "sent",
              amount: "1234.50",
              issueDate: "2026-01-01",
              timeEntries: [
                {
                  id: "entry",
                  hours: "1.5",
                  billableRate: "95",
                  date: "2026-01-01",
                },
              ],
            },
          }),
        },
        update: mutation,
        createCreditNote: mutation,
        delete: mutation,
      },
      integrations: {
        exportInvoiceToBilly: mutation,
        exportInvoiceToDinero: mutation,
      },
      user: { getIntegrationStatus: emptyQuery },
      emailActivity: { getInvoiceStatus: emptyQuery },
      prepaid: {
        getById: {
          useQuery: () => ({
            data: {
              id: "package",
              name: "Design",
              hourlyRate: "95",
              totalHours: "10",
              remainingHours: "10",
              createdAt: "2026-01-01",
            },
          }),
        },
        setRenewal: mutation,
        toggleActive: mutation,
        delete: mutation,
        manualDeduct: mutation,
        topUp: mutation,
        setAutoDeduct: mutation,
        duplicate: mutation,
        setPortalVisibility: mutation,
      },
    },
  };
});

const value = { id: "fixture" };
const params = Object.assign(Promise.resolve(value), {
  status: "fulfilled",
  value,
});

afterEach(() => {
  vi.unstubAllGlobals();
  usageExport.mockClear();
});

it("renders the invoice total and time entry in the account's locale and EUR", async () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="de"
      timeZone="UTC"
      messages={demoCurrencyMessages(await loadMessages("de"), "EUR")}
    >
      <InvoiceDetailPage params={params} />
    </NextIntlClientProvider>,
  );

  expect(html).toContain("1.234,50 EUR");
  expect(html).toContain("142,50 EUR");
});

it("passes the EUR PDF language from the package page to its export", async () => {
  vi.stubGlobal("window", { __TT_CONFIG__: { demo: true } });
  vi.stubGlobal("document", {
    documentElement: { lang: "en", dataset: { demoCurrency: "EUR" } },
  });
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={await loadMessages("en")}
    >
      <PackageDetailPage params={params} />
    </NextIntlClientProvider>,
  );

  expect(usageExport.mock.calls[0]?.[0]).toMatchObject({
    pdfLanguage: { locale: "en", value: "Value (EUR)" },
  });
});
