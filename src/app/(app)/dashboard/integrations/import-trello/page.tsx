"use client";

import { useTranslations } from "next-intl";
import {
  ImportPage,
  type TaskImportResult,
} from "@/components/import/ImportPage";
import { trpc } from "@/providers/trpc-provider";

export default function ImportTrelloPage() {
  const t = useTranslations("integrations.trello");
  const importMutation = trpc.integrations.importTrello.useMutation();

  const handleImport = async (content: string): Promise<TaskImportResult> => {
    const result = await importMutation.mutateAsync({
      jsonContent: content,
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
      fileAccept=".json"
      fileLabel={t("fileLabel")}
      importType="tasks"
      onImport={handleImport}
      extraWarnings={[t("warning1"), t("warning2")]}
      importSource="trello"
    />
  );
}
