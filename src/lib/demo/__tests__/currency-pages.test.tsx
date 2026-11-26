// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import InvoiceDetailPage from "@/app/(app)/dashboard/invoices/[id]/page";
import PackageDetailPage from "@/app/(app)/dashboard/klippekort/[id]/page";
import { loadMessages } from "@/i18n/messages/load";
import { demoCurrencyMessages } from "../currency-messages";

const manualDeduct = vi.hoisted(() => vi.fn(async () => undefined));
const { usageExport, packageBalance } = vi.hoisted(() => ({
  packageBalance: vi.fn(
    (): {
      remainingHours: string;
      overdraftPolicy: string;
      isActive: boolean;
      clipSizeMinutes?: number;
    } => ({
      remainingHours: "10",
      overdraftPolicy: "block",
      isActive: true,
    }),
  ),
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
              ...packageBalance(),
              createdAt: "2026-01-01",
            },
          }),
        },
        setRenewal: mutation,
        toggleActive: mutation,
        delete: mutation,
        manualDeduct: { useMutation: () => ({ mutateAsync: manualDeduct }) },
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
  packageBalance.mockReset();
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

it.each([
  ["allow", false],
  ["block", true],
  ["invoice", true],
])(
  "sets manual deduction availability at zero balance for %s cards",
  async (overdraftPolicy, disabled) => {
    packageBalance.mockReturnValueOnce({
      remainingHours: "0",
      isActive: true,
      overdraftPolicy,
    });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={await loadMessages("en")}
      >
        <PackageDetailPage params={params} />
      </NextIntlClientProvider>,
    );

    const button = html.match(
      /<button[^>]*>(?:(?!<\/button>).)*Deduct hours<\/button>/,
    )?.[0];
    expect(button).toBeDefined();
    expect(button?.includes('disabled=""')).toBe(disabled);
  },
);

it.each([
  ["allow", "3", "5", ""],
  ["invoice", "0.50", "0.50", "0.33"],
  ["block", "0.68", "0.68", "0.67"],
])(
  "applies the manual deduction limit for %s cards",
  async (overdraftPolicy, remainingHours, hours, max) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    manualDeduct.mockClear();
    packageBalance.mockReturnValue({
      remainingHours,
      isActive: true,
      overdraftPolicy,
      clipSizeMinutes: 20,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const deductButton = () =>
      Array.from(host.querySelectorAll("button"))
        .filter((button) => button.textContent === "Deduct hours")
        .at(-1) as HTMLButtonElement;

    try {
      const messages = await loadMessages("en");
      act(() =>
        root.render(
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            messages={messages}
          >
            <PackageDetailPage params={params} />
          </NextIntlClientProvider>,
        ),
      );
      act(() => deductButton().click());
      const input = host.querySelector<HTMLInputElement>(
        "#hours",
      ) as HTMLInputElement;
      const description = host.querySelector<HTMLTextAreaElement>(
        "#description",
      ) as HTMLTextAreaElement;
      function type(
        field: HTMLInputElement | HTMLTextAreaElement,
        value: string,
      ) {
        act(() => {
          Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(field),
            "value",
          )?.set?.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      expect(input.max).toBe(max);
      type(description, "Design work");
      type(input, hours);
      expect(deductButton().disabled).toBe(Boolean(max));
      if (max) {
        act(() => deductButton().click());
        expect(manualDeduct).not.toHaveBeenCalled();
        type(input, max);
      }
      await act(async () => deductButton().click());
      expect(manualDeduct).toHaveBeenCalledExactlyOnceWith({
        packageId: "fixture",
        hours: Number(max || hours),
        description: "Design work",
      });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);

it.each([
  ["block", "0.25", "Not enough hours left for one clip"],
  ["invoice", "0.25", "Not enough hours left for one clip"],
  ["block", "0", "No hours left"],
])(
  "explains why manual deduction is disabled for %s cards with %s h left",
  async (overdraftPolicy, remainingHours, title) => {
    packageBalance.mockReturnValueOnce({
      remainingHours,
      isActive: true,
      overdraftPolicy,
      clipSizeMinutes: 20,
    });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={await loadMessages("en")}
      >
        <PackageDetailPage params={params} />
      </NextIntlClientProvider>,
    );

    const button = html.match(
      /<button[^>]*>(?:(?!<\/button>).)*Deduct hours<\/button>/,
    )?.[0];
    expect(button).toContain('disabled=""');
    expect(button).toContain(`title="${title}"`);
  },
);

async function openDeductDialog() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const messages = await loadMessages("en");
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <PackageDetailPage params={params} />
      </NextIntlClientProvider>,
    ),
  );
  act(() =>
    (
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Deduct hours",
      ) as HTMLButtonElement
    ).click(),
  );
  return {
    host,
    close: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

it.each([
  ["allow", "3", "5", true],
  ["allow", "3", "2", false],
  ["block", "0.68", "0.68", false],
])(
  "notes overdraft debt for %s cards with %s h left and %s h entered",
  async (overdraftPolicy, remainingHours, hours, shown) => {
    packageBalance.mockReturnValue({
      remainingHours,
      isActive: true,
      overdraftPolicy,
      clipSizeMinutes: 20,
    });
    const { host, close } = await openDeductDialog();
    try {
      const input = host.querySelector("#hours") as HTMLInputElement;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, hours);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(
        host.textContent?.includes(
          "This is more than the balance. The difference is recorded as overdraft debt on the package.",
        ),
      ).toBe(shown);
    } finally {
      close();
    }
  },
);

it("formats the manual deduction max like the rest of the page", async () => {
  packageBalance.mockReturnValue({
    remainingHours: "0.68",
    isActive: true,
    overdraftPolicy: "block",
    clipSizeMinutes: 20,
  });
  const { host, close } = await openDeductDialog();
  try {
    expect(host.textContent).toContain("Max: 0:40");
  } finally {
    close();
  }
});
