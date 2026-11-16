"use client";

import {
  ArrowRight,
  CheckSquare,
  Clock,
  FileUp,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useBrand } from "@/components/BrandContext";

interface DataImportStepProps {
  onNext: (data: {
    importSource: "effihub" | "demo" | "manual";
    skipToComplete: boolean;
  }) => void;
  onBack: () => void;
}

const timeImporters = [
  {
    id: "clockify",
    name: "Clockify",
    href: "/dashboard/integrations/import-clockify?onboarding=true",
  },
  {
    id: "toggl",
    name: "Toggl Track",
    href: "/dashboard/integrations/import-toggl?onboarding=true",
  },
  {
    id: "harvest",
    name: "Harvest",
    href: "/dashboard/integrations/import-harvest?onboarding=true",
  },
  {
    id: "effihub",
    name: "Effihub",
    href: "/dashboard/integrations/import-effihub?onboarding=true",
  },
] as const;

const taskImporters = [
  {
    id: "trello",
    name: "Trello",
    href: "/dashboard/integrations/import-trello?onboarding=true",
  },
  {
    id: "todoist",
    name: "Todoist",
    href: "/dashboard/integrations/import-todoist?onboarding=true",
  },
] as const;

export function DataImportStep({ onNext, onBack }: DataImportStepProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("onboarding.import");
  const [seeding, setSeeding] = useState(false);

  const handleManualSetup = () => {
    onNext({
      importSource: "manual",
      skipToComplete: false,
    });
  };

  const handleDemoData = () => {
    // Seed-kaldet sker i OnboardingModal — knappen låses mens det kører.
    setSeeding(true);
    onNext({
      importSource: "demo",
      skipToComplete: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t("title")}</h2>
        <p className="mt-2 text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Progress Indicator */}
      <div className="text-sm text-gray-600">{t("stepOf")}</div>

      {/* Demo-eksempeldata (#86) — hurtigste vej til et levende dashboard */}
      <button
        type="button"
        onClick={handleDemoData}
        disabled={seeding}
        className="group w-full rounded-xl border-2 border-brand-200 bg-brand-50/50 p-6 text-left transition-all hover:border-brand-500 hover:bg-brand-50 disabled:opacity-60 dark:border-brand-600 dark:bg-tt-gran-lys"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 transition-colors group-hover:bg-brand-200">
            <Sparkles className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900">
              {seeding ? t("demoCreating") : t("demoTitle")}
            </h3>
            <p className="mt-0.5 text-sm text-gray-600">
              {t("demoDescription", { brand: brand.name })}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400 transition-all group-hover:text-brand-600" />
        </div>
      </button>

      {/* Time Tracking Importers */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <span className="text-sm font-medium text-gray-700">
            {t("timeTracking")}
          </span>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700 dark:text-brand-400">
            CSV
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {timeImporters.map((imp) => (
            <ImportOptionCard
              key={imp.id}
              name={imp.name}
              description={t(`desc.${imp.id}`)}
              href={imp.href}
            />
          ))}
        </div>
      </div>

      {/* Task Importers */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-gray-700">
            {t("taskManagement")}
          </span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            JSON/CSV
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {taskImporters.map((imp) => (
            <ImportOptionCard
              key={imp.id}
              name={imp.name}
              description={t(`desc.${imp.id}`)}
              href={imp.href}
            />
          ))}
        </div>
      </div>

      {/* Manual Setup */}
      <button
        type="button"
        onClick={handleManualSetup}
        className="group w-full rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-6 text-left transition-all hover:border-brand-500 hover:bg-brand-50/50 dark:hover:bg-tt-gran-lys"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 transition-colors group-hover:bg-gray-200">
            <Plus className="h-6 w-6 text-gray-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900">{t("manualTitle")}</h3>
            <p className="mt-0.5 text-sm text-gray-600">
              {t("manualDescription")}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400 transition-all group-hover:text-brand-600" />
        </div>
      </button>

      {/* Help Text */}
      <div className="rounded-lg bg-brand-50 p-4">
        <h4 className="mb-2 font-semibold text-brand-900 dark:text-brand-400">
          {t("helpTitle")}
        </h4>
        <p className="text-sm text-brand-800 dark:text-brand-400">
          {t("helpBody")}
        </p>
        <Link
          href="/effihub-alternativ"
          target="_blank"
          className="mt-3 inline-block text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {t("effihubMigration")}
        </Link>
      </div>

      {/* Back Button */}
      <div className="pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}

function ImportOptionCard({
  name,
  description,
  href,
}: {
  name: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border-2 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-all hover:border-brand-500 dark:hover:border-brand-600"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 transition-colors group-hover:bg-brand-200">
        <FileUp className="h-5 w-5 text-brand-600 dark:text-brand-400" />
      </div>
      <div className="flex-1">
        <h4 className="font-semibold text-gray-900">{name}</h4>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-400 transition-all group-hover:text-brand-600" />
    </a>
  );
}
