import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import home from "@/i18n/messages/da/home.json";
import invoices from "@/i18n/messages/da/invoices.json";
import { InvoicesEmptyState } from "../InvoicesEmptyState";

const render = (props: Partial<Parameters<typeof InvoicesEmptyState>[0]>) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={{ invoices, home }}>
      <InvoicesEmptyState
        filtered={false}
        canInvoice
        unbilledHours={0}
        onInvoiceUnbilled={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe("InvoicesEmptyState", () => {
  it("tilbyder at fakturere den ufakturerede tid først", () => {
    const html = render({ unbilledHours: 2.5 });
    expect(html).toContain("Du har 2 t 30 min ufaktureret tid");
    expect(html).toContain("Fakturér ufaktureret tid");
    // Blank faktura er stadig muligt, men som andet valg.
    expect(html.indexOf("Fakturér ufaktureret tid")).toBeLessThan(
      html.indexOf("Opret tom faktura"),
    );
  });

  it("peger på tidsregistrering, når der ingen tid er", () => {
    const html = render({ unbilledHours: 0 });
    expect(html).toContain('href="/dashboard/time/new"');
    expect(html).toContain("Registrér tid");
    expect(html).not.toContain("Fakturér ufaktureret tid");
  });

  it("viser ingen knap, mens tallet hentes eller uden rettighed", () => {
    expect(render({ unbilledHours: undefined })).not.toContain("<button");
    expect(render({ canInvoice: false, unbilledHours: 3 })).not.toContain(
      "<button",
    );
  });

  it("sender til virksomhedsoplysningerne først, når de mangler", () => {
    const html = render({ unbilledHours: 2.5, missingCompanyProfile: true });
    expect(html).toContain("Du har 2 t 30 min ufaktureret tid");
    expect(html).toContain('href="/dashboard/settings/company?from=invoices"');
    expect(html).toContain("Udfyld virksomhedsoplysninger");
    // Knappen ville give en fejl, så den vises ikke.
    expect(html).not.toContain("Fakturér ufaktureret tid");
  });

  it("falder tilbage til en blank faktura, når opslaget fejler", () => {
    const html = render({ unbilledHours: undefined, unbilledFailed: true });
    expect(html).toContain('href="/dashboard/invoices/new"');
    expect(html).toContain("Opret første faktura");
  });

  it("beholder filterteksten, når listen er filtreret", () => {
    const html = render({ filtered: true, unbilledHours: 3 });
    expect(html).toContain("Ingen fakturaer fundet");
    expect(html).not.toContain("<button");
  });
});
