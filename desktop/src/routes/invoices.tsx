import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InvoiceList } from "@/components/invoices/InvoiceList";

export const Route = createFileRoute("/invoices")({
  component: InvoicesPage,
});

function InvoicesPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-(--color-text)">
        {t("invoices.title")}
      </h1>
      <InvoiceList />
    </div>
  );
}
