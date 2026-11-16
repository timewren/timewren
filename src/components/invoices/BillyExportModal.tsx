"use client";

import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";

export type BillyExportAction = "draft" | "approve" | "send";
export type BillyLineType = "per_entry" | "combined";

export interface BillyExportSettings {
  action: BillyExportAction;
  productId: string;
  paymentTermsDays: number;
  contactMessage: string;
  lineType: BillyLineType;
  lineTemplate: string;
}

interface BillyExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (settings: BillyExportSettings) => void;
  invoiceId: string;
  clientEmail?: string;
  isLoading?: boolean;
}

// Available template variables (the {{...}} tokens are technical keys and stay as-is)
const TEMPLATE_VARIABLES = [
  { key: "{{beskrivelse}}", id: "description" },
  { key: "{{dato}}", id: "date" },
  { key: "{{tidsforbrug}}", id: "duration" },
  { key: "{{tid}}", id: "time" },
  { key: "{{projekt}}", id: "project" },
  { key: "{{klient}}", id: "client" },
  { key: "{{detaljer}}", id: "details" },
];

const DEFAULT_TEMPLATE =
  "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}";

export function BillyExportModal({
  isOpen,
  onClose,
  onExport,
  clientEmail,
  isLoading = false,
}: BillyExportModalProps) {
  const fid = useId();
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const [action, setAction] = useState<BillyExportAction>("draft");
  const [productId, setProductId] = useState<string>("");
  const [paymentTermsDays, setPaymentTermsDays] = useState<number>(14);
  const [contactMessage, setContactMessage] = useState<string>("");
  const [lineType, setLineType] = useState<BillyLineType>("per_entry");
  const [lineTemplate, setLineTemplate] = useState<string>(DEFAULT_TEMPLATE);
  const [showLineSettings, setShowLineSettings] = useState(false);

  const templateInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch Billy products
  const { data: productsData, isLoading: productsLoading } =
    trpc.integrations.getBillyProducts.useQuery(undefined, {
      enabled: isOpen,
    });

  // Fetch saved line settings
  const { data: lineSettingsData } =
    trpc.integrations.getBillyLineSettings.useQuery(undefined, {
      enabled: isOpen,
    });

  // Save line settings mutation
  const saveLineSettingsMutation =
    trpc.integrations.setBillyLineSettings.useMutation();

  // Set defaults when data loads
  useEffect(() => {
    if (productsData?.products && productsData.products.length > 0) {
      const defaultProduct =
        productsData.defaultProductId || productsData.products[0]?.id;
      if (defaultProduct && !productId) {
        setProductId(defaultProduct);
      }
    }
  }, [productsData, productId]);

  useEffect(() => {
    if (lineSettingsData) {
      setLineType(lineSettingsData.lineType);
      setLineTemplate(lineSettingsData.lineTemplate);
    }
  }, [lineSettingsData]);

  // Insert variable at cursor position
  const insertVariable = (variable: string) => {
    const input = templateInputRef.current;
    if (!input) return;

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const newValue =
      lineTemplate.substring(0, start) + variable + lineTemplate.substring(end);
    setLineTemplate(newValue);

    // Set cursor position after inserted variable
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  // Generate preview of the template
  const getTemplatePreview = () => {
    let preview = lineTemplate;
    for (const v of TEMPLATE_VARIABLES) {
      preview = preview.replace(
        new RegExp(v.key.replace(/[{}]/g, "\\$&"), "g"),
        t(`exportCommon.vars.${v.id}.example`),
      );
    }
    return preview || t("exportCommon.empty");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return;

    // Save line settings for future use
    if (
      lineSettingsData?.lineType !== lineType ||
      lineSettingsData?.lineTemplate !== lineTemplate
    ) {
      saveLineSettingsMutation.mutate({ lineType, lineTemplate });
    }

    onExport({
      action,
      productId,
      paymentTermsDays,
      contactMessage,
      lineType,
      lineTemplate,
    });
  };

  const actionOptions: {
    value: BillyExportAction;
    label: string;
    description: string;
  }[] = [
    {
      value: "draft",
      label: t("exportCommon.actionDraft"),
      description: t("billy.draftHint"),
    },
    {
      value: "approve",
      label: t("billy.approve"),
      description: t("billy.approveHint"),
    },
    {
      value: "send",
      label: t("billy.send"),
      description: t("billy.sendHint"),
    },
  ];

  const lineTypeOptions: {
    value: BillyLineType;
    label: string;
    description: string;
  }[] = [
    {
      value: "per_entry",
      label: t("exportCommon.perEntry"),
      description: t("exportCommon.perEntryHint"),
    },
    {
      value: "combined",
      label: t("exportCommon.combined"),
      description: t("exportCommon.combinedHint"),
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("billy.title")}
      description={t("billy.description")}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Action/Handling */}
        <div>
          <label
            htmlFor={`${fid}-f1`}
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {t("exportCommon.actionLabel")}
          </label>
          <select
            id={`${fid}-f1`}
            value={action}
            onChange={(e) => setAction(e.target.value as BillyExportAction)}
            className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
          >
            {actionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {actionOptions.find((o) => o.value === action)?.description}
          </p>
        </div>

        {/* Product selection */}
        <div>
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {t("billy.product")}
          </span>
          {productsLoading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("billy.loadingProducts")}</span>
            </div>
          ) : (
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
              required
            >
              <option value="">{t("billy.chooseProduct")}</option>
              {productsData?.products?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.productNo ? ` (${product.productNo})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Payment terms */}
        <div>
          <label
            htmlFor={`${fid}-f2`}
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {t("exportCommon.paymentDays")}
          </label>
          <input
            id={`${fid}-f2`}
            type="number"
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
            min={1}
            max={365}
            className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
          />
        </div>

        {/* Invoice Line Settings - Collapsible */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLineSettings(!showLineSettings)}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("exportCommon.lineSettings")}
            </span>
            {showLineSettings ? (
              <ChevronUp className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            )}
          </button>

          {showLineSettings && (
            <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-800">
              {/* Line Type */}
              <div>
                <label
                  htmlFor={`${fid}-f3`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("exportCommon.invoiceType")}
                </label>
                <select
                  id={`${fid}-f3`}
                  value={lineType}
                  onChange={(e) => setLineType(e.target.value as BillyLineType)}
                  className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  {lineTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {
                    lineTypeOptions.find((o) => o.value === lineType)
                      ?.description
                  }
                </p>
              </div>

              {/* Line Template */}
              <div>
                <label
                  htmlFor={`${fid}-f4`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("exportCommon.lineTemplate")}
                </label>
                <textarea
                  id={`${fid}-f4`}
                  ref={templateInputRef}
                  value={lineTemplate}
                  onChange={(e) => setLineTemplate(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500 font-mono text-sm resize-none"
                  placeholder="{{beskrivelse}} | Dato: {{dato}}"
                />

                {/* Variable buttons */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="px-2 py-1 text-xs font-medium bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300 rounded-md hover:bg-brand-200 dark:hover:bg-tt-gran-lys transition-colors"
                    >
                      {t(`exportCommon.vars.${v.id}.label`)}:{" "}
                      <span className="font-mono">{v.key}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div>
                <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("exportCommon.preview")}
                </span>
                <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
                  <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                    {getTemplatePreview()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Extra message */}
        <div>
          <label
            htmlFor={`${fid}-f5`}
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {t("exportCommon.extraMessage")}
          </label>
          <textarea
            id={`${fid}-f5`}
            value={contactMessage}
            onChange={(e) => setContactMessage(e.target.value)}
            rows={2}
            placeholder={t("exportCommon.extraMessagePlaceholder")}
            className="w-full px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500 resize-none"
          />
        </div>

        {/* Warning for send action without email */}
        {action === "send" && !clientEmail && (
          <div className="p-3 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg">
            <p className="text-sm text-warning-700 dark:text-warning-400">
              {t("exportCommon.noEmail")}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            disabled={isLoading || !productId || productsLoading}
            className="px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? t("exportCommon.exporting") : t("billy.export")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
