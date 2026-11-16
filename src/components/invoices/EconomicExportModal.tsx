"use client";

import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { trpc } from "@/providers/trpc-provider";

export interface EconomicExportSettings {
  layoutNumber?: number;
  paymentTermsNumber?: number;
  productNumber?: string;
  autoBook: boolean;
  lineType?: "per_entry" | "combined";
}

interface EconomicExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (settings: EconomicExportSettings) => void;
  isLoading: boolean;
}

export function EconomicExportModal({
  isOpen,
  onClose,
  onExport,
  isLoading,
}: EconomicExportModalProps) {
  const fid = useId();
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  useEscapeKey(onClose, isOpen);
  const { data: layouts } = trpc.integrations.getEconomicLayouts.useQuery(
    undefined,
    { enabled: isOpen },
  );
  const { data: paymentTerms } =
    trpc.integrations.getEconomicPaymentTerms.useQuery(undefined, {
      enabled: isOpen,
    });
  const { data: products } = trpc.integrations.getEconomicProducts.useQuery(
    undefined,
    { enabled: isOpen },
  );
  const { data: lineSettings } =
    trpc.integrations.getEconomicLineSettings.useQuery(undefined, {
      enabled: isOpen,
    });

  const [layoutNumber, setLayoutNumber] = useState<string>("");
  const [paymentTermsNumber, setPaymentTermsNumber] = useState<string>("");
  const [productNumber, setProductNumber] = useState<string>("");
  const [autoBook, setAutoBook] = useState(false);
  const [lineType, setLineType] = useState<"per_entry" | "combined">(
    "per_entry",
  );
  const [showLineSettings, setShowLineSettings] = useState(false);

  useEffect(() => {
    if (lineSettings) {
      setLayoutNumber(lineSettings.defaultLayoutNumber?.toString() || "");
      setPaymentTermsNumber(
        lineSettings.defaultPaymentTermsNumber?.toString() || "",
      );
      if (
        lineSettings.lineType === "per_entry" ||
        lineSettings.lineType === "combined"
      ) {
        setLineType(lineSettings.lineType);
      }
    }
  }, [lineSettings]);

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("economic.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div>
            <label
              htmlFor={`${fid}-f1`}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              {t("economic.layout")}
            </label>
            <select
              id={`${fid}-f1`}
              value={layoutNumber}
              onChange={(e) => setLayoutNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="">{t("economic.standard")}</option>
              {layouts?.map((l) => (
                <option key={l.layoutNumber} value={l.layoutNumber}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f2`}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              {t("economic.paymentTerms")}
            </label>
            <select
              id={`${fid}-f2`}
              value={paymentTermsNumber}
              onChange={(e) => setPaymentTermsNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="">{t("economic.choose")}</option>
              {paymentTerms?.map((pt) => (
                <option
                  key={pt.paymentTermsNumber}
                  value={pt.paymentTermsNumber}
                >
                  {t("economic.paymentTermOption", {
                    name: pt.name,
                    days: pt.daysOfCredit,
                  })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f3`}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              {t("economic.product")}
            </label>
            <select
              id={`${fid}-f3`}
              value={productNumber}
              onChange={(e) => setProductNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="">{t("economic.noProduct")}</option>
              {products?.map((p) => (
                <option key={p.productNumber} value={p.productNumber}>
                  {p.name} ({p.productNumber})
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowLineSettings(!showLineSettings)}
              className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              {showLineSettings ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {t("economic.lineSettings")}
            </button>
            {showLineSettings && (
              <div className="mt-2 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="lineType"
                    value="per_entry"
                    checked={lineType === "per_entry"}
                    onChange={() => setLineType("per_entry")}
                    className="border-gray-300"
                  />
                  {t("economic.perEntry")}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="lineType"
                    value="combined"
                    checked={lineType === "combined"}
                    onChange={() => setLineType("combined")}
                    className="border-gray-300"
                  />
                  {t("economic.combined")}
                </label>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={autoBook}
              onChange={(e) => setAutoBook(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t("economic.autoBook")}
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 dark:border-gray-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={() =>
              onExport({
                layoutNumber: layoutNumber ? Number(layoutNumber) : undefined,
                paymentTermsNumber: paymentTermsNumber
                  ? Number(paymentTermsNumber)
                  : undefined,
                productNumber: productNumber || undefined,
                autoBook,
                lineType,
              })
            }
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("economic.exporting")}
              </>
            ) : (
              t("economic.export")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
