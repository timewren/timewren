"use client";

import { useTranslations } from "next-intl";
import {
  ImportPage,
  type TimeImportResult,
} from "@/components/import/ImportPage";
import type { DateFormat } from "@/lib/import-parsers/date-parser";
import { trpc } from "@/providers/trpc-provider";

export default function ImportTogglPage() {
  const t = useTranslations("integrations.toggl");
  const importMutation = trpc.integrations.importToggl.useMutation();

  const handleImport = async (
    content: string,
    dateFormat?: DateFormat,
    _billingFilter?: unknown,
    markAllAsBilled?: boolean,
  ): Promise<TimeImportResult> => {
    const result = await importMutation.mutateAsync({
      csvContent: content,
      dateFormat,
      markAllAsBilled: markAllAsBilled ?? false,
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
      showDateFormatPicker
      showMarkAllAsBilled
      importSource="toggl"
    />
  );
}
