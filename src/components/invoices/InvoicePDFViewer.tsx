"use client";

import { FileText, Loader2, Maximize2, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface InvoicePDFViewerProps {
  invoiceId: string;
  invoiceNumber: string;
}

export function InvoicePDFViewer({
  invoiceId,
  invoiceNumber,
}: InvoicePDFViewerProps) {
  const t = useTranslations("invoices");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  const loadPdf = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`);
      if (!response.ok) {
        throw new Error("Failed to load PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // Revoke previous URL if exists
      if (pdfUrlRef.current) {
        window.URL.revokeObjectURL(pdfUrlRef.current);
      }

      pdfUrlRef.current = url;
      setPdfUrl(url);
    } catch (error) {
      console.error("PDF load error:", error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadPdf();

    return () => {
      if (pdfUrlRef.current) {
        window.URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [loadPdf]);

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Fullscreen modal
  if (isFullscreen && pdfUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
        {/* Fullscreen header */}
        <div className="flex items-center justify-between bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-white" />
            <span className="text-white font-medium">
              {t("pdf.invoiceTitle", { number: invoiceNumber })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPdf}
              className="rounded-lg p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
              title={t("pdf.reload")}
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleFullscreen}
              className="rounded-lg p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
              title={t("pdf.closeFullscreen")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Fullscreen PDF */}
        <div className="flex-1 overflow-hidden">
          <iframe
            src={pdfUrl}
            className="h-full w-full border-0"
            title={t("pdf.invoiceTitle", { number: invoiceNumber })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("pdf.title")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadPdf}
            disabled={isLoading}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
            title={t("pdf.reload")}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
          {pdfUrl && (
            <button
              type="button"
              onClick={handleFullscreen}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
              title={t("pdf.fullscreen")}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="aspect-[3/4] rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {t("pdf.loading")}
              </p>
            </div>
          </div>
        ) : hasError ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {t("pdf.loadFailed")}
              </p>
              <button
                type="button"
                onClick={loadPdf}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <RefreshCw className="h-4 w-4" />
                {t("pdf.retry")}
              </button>
            </div>
          </div>
        ) : pdfUrl ? (
          <iframe
            src={pdfUrl}
            className="h-full w-full border-0"
            title={t("pdf.invoiceTitle", { number: invoiceNumber })}
          />
        ) : null}
      </div>
    </div>
  );
}
