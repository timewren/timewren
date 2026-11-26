import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import common from "@/i18n/messages/da/common.json";
import invoices from "@/i18n/messages/da/invoices.json";
import { GenerateFromTimeEntriesModal } from "../GenerateFromTimeEntriesModal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    invoices: {
      getUninvoicedSummary: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              client: { id: "c1", name: "Kunde A/S" },
              entryIds: ["e1"],
              entryCount: 1,
              totalHours: 2.5,
              totalAmount: 2125,
              projects: [],
            },
          ],
        }),
      },
      generateFromTimeEntries: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const render = (missingCompanyProfile?: boolean) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={{ invoices, common }}>
      <GenerateFromTimeEntriesModal
        isOpen
        onClose={vi.fn()}
        missingCompanyProfile={missingCompanyProfile}
      />
    </NextIntlClientProvider>,
  );

describe("GenerateFromTimeEntriesModal", () => {
  it("viser kunderne med ufaktureret tid", () => {
    const html = render();
    expect(html).toContain("Kunde A/S");
    expect(html).not.toContain("/dashboard/settings/company");
  });

  it("sender til virksomhedsoplysningerne før den første faktura", () => {
    const html = render(true);
    // Samme link og vej tilbage som den tomme fakturaliste.
    expect(html).toContain('href="/dashboard/settings/company?from=invoices"');
    expect(html).toContain("Udfyld virksomhedsoplysninger");
    expect(html).not.toContain("Kunde A/S");
  });
});
