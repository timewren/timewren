"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface FirstClientStepProps {
  onNext: (data: {
    createClient: boolean;
    clientName?: string;
    clientEmail?: string;
    projectName?: string;
    hourlyRate?: string;
  }) => void;
  onSkip: () => void;
  onBack?: () => void;
  defaultHourlyRate?: string;
}

export function FirstClientStep({
  onNext,
  onSkip,
  onBack,
  defaultHourlyRate,
}: FirstClientStepProps) {
  const t = useTranslations("onboarding.firstClient");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [hourlyRate, setHourlyRate] = useState(defaultHourlyRate || "750");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      createClient: true,
      clientName,
      clientEmail: clientEmail || undefined,
      projectName,
      hourlyRate: hourlyRate || undefined,
    });
  };

  const handleSkip = () => {
    onSkip();
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

      {/* Quick Start Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg bg-gray-50 p-6"
      >
        <div>
          <label
            htmlFor="clientName"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("nameLabel")}
          </label>
          <input
            id="clientName"
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder={t("namePlaceholder")}
          />
        </div>

        <div>
          <label
            htmlFor="clientEmail"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("emailLabel")}
          </label>
          <input
            id="clientEmail"
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder="contact@acme.com"
          />
        </div>

        <div>
          <label
            htmlFor="projectName"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("projectLabel")}
          </label>
          <input
            id="projectName"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder={t("projectPlaceholder")}
          />
        </div>

        <div>
          <label
            htmlFor="hourlyRate"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("rateLabel")}
          </label>
          <input
            id="hourlyRate"
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder="750"
          />
          <p className="mt-1 text-sm text-gray-500">
            {defaultHourlyRate
              ? t("defaultRate", { rate: defaultHourlyRate })
              : t("standardRate")}
          </p>
        </div>

        {/* Success Preview */}
        <div className="rounded-lg bg-green-50 p-4">
          <p className="mb-2 text-sm font-semibold text-green-900">
            {t("willCreate")}
          </p>
          <ul className="space-y-1 text-sm text-green-800">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>
                {t("previewClient", {
                  name: clientName || t("namePlaceholder"),
                })}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>
                {t("previewProject", {
                  name: projectName || t("projectPlaceholder"),
                })}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>{t("previewRate", { rate: hourlyRate || "750" })}</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("back")}
            </button>
          )}
          <button
            type="button"
            onClick={handleSkip}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t("skip")}
          </button>
          <button
            type="submit"
            className="flex-1 rounded-lg bg-tt-gran px-6 py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("create")}
          </button>
        </div>
      </form>

      {/* Skip Option */}
      <div className="text-center">
        <button
          type="button"
          onClick={handleSkip}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          {t("later")}
        </button>
      </div>
    </div>
  );
}
