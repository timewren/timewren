"use client";

import { ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

export function FeatureGate({
  featureKey,
  children,
}: {
  featureKey: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("shell.guard");
  const { isEnabled, isLoading } = useFeatureFlags();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <InlineSpinner className="h-8 w-8" />
      </div>
    );
  }

  if (!isEnabled(featureKey)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldOff className="h-12 w-12 text-gray-400 dark:text-gray-500" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t("featureDisabledTitle")}
        </h2>
        <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
          {t("featureDisabledBody")}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
