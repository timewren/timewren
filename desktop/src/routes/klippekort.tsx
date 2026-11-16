import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { KlippekortList } from "@/components/klippekort/KlippekortList";

export const Route = createFileRoute("/klippekort")({
  component: KlippekortPage,
});

function KlippekortPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-(--color-text)">
        {t("klippekort.title")}
      </h1>
      <KlippekortList />
    </div>
  );
}
