"use client";

import { HelpCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type BreadcrumbItem,
  Breadcrumbs,
  useAutoBreadcrumbs,
} from "./Breadcrumbs";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  dynamicLabels?: Record<string, string>;
  helpTopicId?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  dynamicLabels,
  helpTopicId,
}: PageHeaderProps) {
  const t = useTranslations("shell");
  const autoBreadcrumbs = useAutoBreadcrumbs(dynamicLabels);
  const items = breadcrumbs ?? autoBreadcrumbs;

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2">
          <Breadcrumbs items={items} />
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white sm:text-2xl">
              {title}
            </h1>
            {helpTopicId && (
              <Link
                href={`/dashboard/help?topic=${helpTopicId}`}
                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-brand-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-brand-400"
                title={t("pageHelp")}
              >
                <HelpCircle className="h-5 w-5" />
              </Link>
            )}
          </div>
          {description && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
        {/* Knaprækker må ombryde på mobil, ellers bliver hele siden bredere
            end skærmen (fx Rapporters syv knapper) */}
        {actions && <div className="min-w-0 *:flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}
