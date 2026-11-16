"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";

interface FlexBalanceProps {
  balance: number;
  label?: string;
}

export function FlexBalance({ balance, label }: FlexBalanceProps) {
  const t = useTranslations("enterpriseComponents.flexBalance");
  const isPositive = balance > 0;
  const isNegative = balance < 0;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-gray-400" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {label ?? t("current")}
        </p>
      </div>
      <p
        className={`text-3xl font-bold ${
          isPositive
            ? "text-green-600 dark:text-green-400"
            : isNegative
              ? "text-red-600 dark:text-red-400"
              : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {isPositive ? "+" : ""}
        {balance.toFixed(1)}
        <span className="ml-1 text-base font-normal text-gray-500 dark:text-gray-400">
          {t("hours")}
        </span>
      </p>
    </div>
  );
}
