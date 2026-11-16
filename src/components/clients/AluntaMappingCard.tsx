"use client";

import { Edit, Pause, Play, RefreshCw, Settings, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";
import { AluntaMappingForm } from "./AluntaMappingForm";

interface AluntaMappingCardProps {
  clientId: string;
}

const RENEWAL_KEYS = ["parallel", "transfer", "archive"] as const;

export function AluntaMappingCard({ clientId }: AluntaMappingCardProps) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const utils = trpc.useUtils();

  const { data: mapping, isLoading } =
    trpc.aluntaKlippekort.getMappingForClient.useQuery({ clientId });

  const toggleMutation = trpc.aluntaKlippekort.updateMapping.useMutation({
    onSuccess: (updated) => {
      toast.success(
        updated.isActive
          ? t("aluntaMapping.resumed")
          : t("aluntaMapping.paused"),
      );
      utils.aluntaKlippekort.getMappingForClient.invalidate({ clientId });
      utils.aluntaKlippekort.listMappings.invalidate();
    },
    onError: (error) => {
      toast.error(t("aluntaMapping.updateFailed"), {
        description: error.message,
      });
    },
  });

  const deleteMutation = trpc.aluntaKlippekort.deleteMapping.useMutation({
    onSuccess: () => {
      toast.success(t("aluntaMapping.deleted"));
      utils.aluntaKlippekort.getMappingForClient.invalidate({ clientId });
      utils.aluntaKlippekort.listMappings.invalidate();
      setConfirmDelete(false);
    },
    onError: (error) => {
      toast.error(t("aluntaMapping.deleteFailed"), {
        description: error.message,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="mt-2 h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  // ── No mapping: show CTA ──
  if (!mapping) {
    return (
      <>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-4 text-left hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys text-brand-600 dark:text-brand-400 group-hover:bg-brand-200 dark:group-hover:bg-tt-gran-lys transition-colors">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {t("aluntaMapping.ctaTitle")}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("aluntaMapping.ctaDescription")}
              </p>
            </div>
            <div className="ml-auto">
              <span className="inline-flex items-center gap-1 rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-medium text-tt-paa-gran group-hover:bg-brand-600 transition-colors">
                <Settings className="h-3 w-3" />
                {t("aluntaMapping.setUp")}
              </span>
            </div>
          </div>
        </button>

        <AluntaMappingForm
          clientId={clientId}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      </>
    );
  }

  // ── Active or paused mapping ──
  const isPaused = !mapping.isActive;

  return (
    <>
      <div
        className={`rounded-lg border p-4 transition-colors ${
          isPaused
            ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-70"
            : "border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                isPaused
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  : "bg-brand-100 dark:bg-tt-gran-lys text-brand-600 dark:text-brand-400"
              }`}
            >
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {mapping.aluntaPlanName}
                </p>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    isPaused
                      ? "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                      : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                  }`}
                >
                  {isPaused
                    ? t("aluntaMapping.statusPaused")
                    : t("aluntaMapping.statusActive")}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {mapping.aluntaPlanUuid}
              </p>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aluntaMapping.hoursPerPeriod")}
            </p>
            <p className="font-medium text-gray-900 dark:text-white">
              {t("aluntaMapping.hoursValue", {
                hours: mapping.hoursPerPeriod,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aluntaMapping.hourlyRate")}
            </p>
            <p className="font-medium text-gray-900 dark:text-white">
              {t("aluntaMapping.rateValue", { rate: mapping.hourlyRate })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("aluntaMapping.onRenewal")}
            </p>
            <p className="font-medium text-gray-900 dark:text-white">
              {(RENEWAL_KEYS as readonly string[]).includes(
                mapping.renewalBehavior,
              )
                ? t(`aluntaMapping.renewal.${mapping.renewalBehavior}`)
                : mapping.renewalBehavior}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Edit className="h-3 w-3" />
            {tc("edit")}
          </button>
          <button
            type="button"
            onClick={() =>
              toggleMutation.mutate({
                id: mapping.id,
                isActive: !mapping.isActive,
              })
            }
            disabled={toggleMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {isPaused ? (
              <>
                <Play className="h-3 w-3" />
                {t("aluntaMapping.resume")}
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" />
                {t("aluntaMapping.pause")}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-danger-600 dark:text-danger-400 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {tc("delete")}
          </button>
        </div>
      </div>

      <AluntaMappingForm
        clientId={clientId}
        existingMapping={mapping}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate({ id: mapping.id })}
        title={t("aluntaMapping.deleteTitle")}
        description={t("aluntaMapping.deleteDescription")}
        confirmLabel={t("aluntaMapping.deleteConfirm")}
        cancelLabel={tc("cancel")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
