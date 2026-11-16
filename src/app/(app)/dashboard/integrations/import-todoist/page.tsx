"use client";

import { useTranslations } from "next-intl";
import {
  ImportPage,
  type TaskImportResult,
} from "@/components/import/ImportPage";
import { trpc } from "@/providers/trpc-provider";

export default function ImportTodoistPage() {
  const t = useTranslations("integrations.todoist");
  const importMutation = trpc.integrations.importTodoist.useMutation();

  const handleImport = async (content: string): Promise<TaskImportResult> => {
    const result = await importMutation.mutateAsync({
      csvContent: content,
    });
    return { type: "tasks", ...result };
  };

  return (
    <ImportPage
      title={t("title")}
      description={t("description")}
      instructions={{
        title: t("instructionsTitle"),
        steps: [t("step1"), t("step2"), t("step3"), t("step4")],
      }}
      fileAccept=".csv"
      fileLabel={t("fileLabel")}
      importType="tasks"
      onImport={handleImport}
      extraWarnings={[t("warning1"), t("warning2")]}
      importSource="todoist"
    />
  );
}
