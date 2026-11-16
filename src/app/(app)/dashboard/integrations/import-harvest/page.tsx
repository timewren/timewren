"use client";

import { useTranslations } from "next-intl";
import {
  type BillingFilter,
  ImportPage,
  type TimeImportResult,
} from "@/components/import/ImportPage";
import { trpc } from "@/providers/trpc-provider";

export default function ImportHarvestPage() {
  const t = useTranslations("integrations.harvest");
  const importMutation = trpc.integrations.importHarvest.useMutation();

  const handleImport = async (
    content: string,
    _dateFormat?: unknown,
    billingFilter?: BillingFilter,
  ): Promise<TimeImportResult> => {
    const result = await importMutation.mutateAsync({
      csvContent: content,
      billingFilter: billingFilter ?? "all",
    });
    return { type: "time", ...result };
  };

  return (
    <ImportPage
      title={t("title")}
      description={t("description")}
      instructions={{
        title: t("instructionsTitle"),
        steps: [t("step1"), t("step2"), t("step3"), t("step4"), t("step5")],
      }}
      fileAccept=".csv"
      fileLabel={t("fileLabel")}
      importType="time"
      onImport={handleImport}
      showBillingFilter
      extraWarnings={[t("warning")]}
      importSource="harvest"
    />
  );
}
