"use client";

import { useTranslations } from "next-intl";
import { ActivityView } from "@/components/admin/views/ActivityView";

export default function AdminActivityPage() {
  const t = useTranslations("adminActivity");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t("page.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t("page.subtitle")}</p>
      </div>
      <ActivityView />
    </div>
  );
}
