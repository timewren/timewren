"use client";

import { GripVertical, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface InvoiceLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  timeEntryId: string | null;
  sortOrder: number;
}

interface InvoiceLineEditorProps {
  invoiceId: string;
  readOnly?: boolean;
  onTotalChange?: (total: number) => void;
}

export function InvoiceLineEditor({
  invoiceId,
  readOnly = false,
  onTotalChange,
}: InvoiceLineEditorProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  // Beløb vises i sprogets format (2.125,00 på dansk), ikke som "2125.00".
  const displayAmount = (amount: number) =>
    formatCurrency(amount, { locale, suffix: "", decimals: 2 });
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const { data: fetchedLines, isLoading } = trpc.invoices.getLines.useQuery(
    { invoiceId },
    { enabled: !!invoiceId },
  );

  const saveLinesMutation = trpc.invoices.saveLines.useMutation({
    onSuccess: () => {
      toast.success(t("lineEditor.saved"));
      setHasChanges(false);
    },
    onError: (error) => {
      toast.error(error.message || t("lineEditor.saveFailed"));
    },
  });

  const utils = trpc.useUtils();

  useEffect(() => {
    if (fetchedLines) {
      setLines(
        fetchedLines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          timeEntryId: line.timeEntryId,
          sortOrder: line.sortOrder,
        })),
      );
    }
  }, [fetchedLines]);

  const calculateAmount = (quantity: string, unitPrice: string): string => {
    const qty = Number.parseFloat(quantity) || 0;
    const price = Number.parseFloat(unitPrice) || 0;
    return (qty * price).toFixed(2);
  };

  const totalAmount = lines.reduce(
    (sum, line) => sum + (Number.parseFloat(line.amount) || 0),
    0,
  );

  useEffect(() => {
    onTotalChange?.(totalAmount);
  }, [totalAmount, onTotalChange]);

  const handleAddLine = () => {
    const newLine: InvoiceLine = {
      id: `temp-${Date.now()}`,
      description: "",
      quantity: "1",
      unitPrice: "0",
      amount: "0",
      timeEntryId: null,
      sortOrder: lines.length,
    };
    setLines([...lines, newLine]);
    setHasChanges(true);
  };

  const handleUpdateLine = (
    index: number,
    field: keyof InvoiceLine,
    value: string,
  ) => {
    const updatedLines = [...lines];
    const line = { ...updatedLines[index] };

    if (field === "quantity" || field === "unitPrice") {
      line[field] = value;
      line.amount = calculateAmount(
        field === "quantity" ? value : line.quantity,
        field === "unitPrice" ? value : line.unitPrice,
      );
    } else if (field === "description") {
      line.description = value;
    }

    updatedLines[index] = line;
    setLines(updatedLines);
    setHasChanges(true);
  };

  const handleDeleteLine = (index: number) => {
    const updatedLines = lines.filter((_, i) => i !== index);
    const reorderedLines = updatedLines.map((line, i) => ({
      ...line,
      sortOrder: i,
    }));
    setLines(reorderedLines);
    setHasChanges(true);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updatedLines = [...lines];
    const [draggedItem] = updatedLines.splice(draggedIndex, 1);
    updatedLines.splice(index, 0, draggedItem);

    const reorderedLines = updatedLines.map((line, i) => ({
      ...line,
      sortOrder: i,
    }));

    setLines(reorderedLines);
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = async () => {
    await saveLinesMutation.mutateAsync({
      invoiceId,
      lines: lines.map((line) => ({
        id: line.id.startsWith("temp-") ? undefined : line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        timeEntryId: line.timeEntryId,
        sortOrder: line.sortOrder,
      })),
    });

    // Refresh invoice data
    utils.invoices.getById.invalidate({ id: invoiceId });
    utils.invoices.getLines.invalidate({ invoiceId });
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("lineEditor.title")}
        </h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saveLinesMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {saveLinesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("lineEditor.saveChanges")}
              </button>
            )}
            <button
              type="button"
              onClick={handleAddLine}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" />
              {t("lineEditor.addLine")}
            </button>
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          <p>{t("lineEditor.empty")}</p>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddLine}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              <Plus className="h-4 w-4" />
              {t("lineEditor.addFirst")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header — hidden on mobile where lines stack vertically */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <div className="col-span-1" />
            <div className="col-span-5">{t("lineEditor.colDescription")}</div>
            <div className="col-span-2 text-right">
              {t("lineEditor.colQuantity")}
            </div>
            <div className="col-span-2 text-right">
              {t("lineEditor.colUnitPrice")}
            </div>
            <div className="col-span-1 text-right">
              {t("lineEditor.colAmount")}
            </div>
            <div className="col-span-1" />
          </div>

          {/* Lines */}
          {lines.map((line, index) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: træk-og-slip er mus-/touch-interaktion; samme handling findes som knapper/tastatur ved siden af
            <div
              key={line.id}
              draggable={!readOnly}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`p-2 rounded-lg border ${
                draggedIndex === index
                  ? "border-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              {/* Desktop: grid row */}
              <div className="hidden md:grid grid-cols-12 gap-2 items-center">
                {/* Drag handle */}
                <div className="col-span-1 flex justify-center">
                  {!readOnly && (
                    <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
                  )}
                </div>

                {/* Description */}
                <div className="col-span-5">
                  {readOnly ? (
                    <span className="text-sm text-gray-900 dark:text-white">
                      {line.description || "–"}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) =>
                        handleUpdateLine(index, "description", e.target.value)
                      }
                      placeholder={t("lineEditor.descriptionPlaceholder")}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  )}
                </div>

                {/* Quantity */}
                <div className="col-span-2">
                  {readOnly ? (
                    <span className="block text-right text-sm text-gray-900 dark:text-white">
                      {line.quantity}
                    </span>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.quantity}
                      onChange={(e) =>
                        handleUpdateLine(index, "quantity", e.target.value)
                      }
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-right text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  )}
                </div>

                {/* Unit Price */}
                <div className="col-span-2">
                  {readOnly ? (
                    <span className="block text-right text-sm text-gray-900 dark:text-white">
                      {t("lineEditor.priceValue", {
                        price: displayAmount(Number.parseFloat(line.unitPrice)),
                      })}
                    </span>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) =>
                        handleUpdateLine(index, "unitPrice", e.target.value)
                      }
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-right text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  )}
                </div>

                {/* Amount (calculated) */}
                <div className="col-span-1 text-right">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {displayAmount(Number.parseFloat(line.amount))}
                  </span>
                </div>

                {/* Delete button */}
                <div className="col-span-1 flex justify-center">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleDeleteLine(index)}
                      className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      title={t("lineEditor.deleteLine")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mobile: stacked layout */}
              <div className="md:hidden space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {!readOnly && (
                    <GripVertical className="h-4 w-4 shrink-0 text-gray-400 cursor-grab" />
                  )}
                  <div className="flex-1 min-w-0">
                    {readOnly ? (
                      <span className="text-sm text-gray-900 dark:text-white truncate block">
                        {line.description || "–"}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) =>
                          handleUpdateLine(index, "description", e.target.value)
                        }
                        placeholder={t("lineEditor.descriptionPlaceholder")}
                        className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleDeleteLine(index)}
                      className="p-1 shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      title={t("lineEditor.deleteLine")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t("lineEditor.colQuantity")}
                    </span>
                    {readOnly ? (
                      <span className="block text-sm text-gray-900 dark:text-white">
                        {line.quantity}
                      </span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) =>
                          handleUpdateLine(index, "quantity", e.target.value)
                        }
                        className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t("lineEditor.colUnitPrice")}
                    </span>
                    {readOnly ? (
                      <span className="block text-sm text-gray-900 dark:text-white">
                        {t("lineEditor.priceValue", {
                          price: displayAmount(
                            Number.parseFloat(line.unitPrice),
                          ),
                        })}
                      </span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={(e) =>
                          handleUpdateLine(index, "unitPrice", e.target.value)
                        }
                        className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {t("lineEditor.colAmount")}
                    </span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">
                      {displayAmount(Number.parseFloat(line.amount))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Total */}
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
            <span className="text-base font-medium text-gray-900 dark:text-white">
              {t("lineEditor.total")}
            </span>
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              {t("lineEditor.priceValue", {
                price: displayAmount(totalAmount),
              })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
