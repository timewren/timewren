// src/app/dashboard/reports/_components/ShareLinkDialog.tsx
"use client";
import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";

interface Props {
  open: boolean;
  config: ReportTemplateConfig;
  onClose: () => void;
}

export function ShareLinkDialog({ open, config, onClose }: Props) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [lockDates, setLockDates] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) nameInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const utils = trpc.useUtils();
  const { data: links } = trpc.reports.listShareLinks.useQuery(undefined, {
    enabled: open,
  });

  const copyToClipboard = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success(t("share.copied"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const create = trpc.reports.createShareLink.useMutation({
    onSuccess: async (link) => {
      utils.reports.listShareLinks.invalidate();
      await copyToClipboard(link.id, link.url);
      setName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = trpc.reports.revokeShareLink.useMutation({
    onSuccess: () => {
      utils.reports.listShareLinks.invalidate();
      toast.success(t("share.revoked"));
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label={tc("close")}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Link2 className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          {t("share.title")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("share.intro")}
        </p>

        <div className="mt-4 space-y-3">
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("share.namePlaceholder")}
            maxLength={120}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={lockDates}
              onChange={(e) => setLockDates(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span>
              {t.rich("share.lockDates", {
                hint: (chunks) => (
                  <span className="text-gray-500 dark:text-gray-400">
                    {chunks}
                  </span>
                ),
              })}
            </span>
          </label>
          <button
            type="button"
            onClick={() =>
              create.mutate({ config, name: name.trim(), lockDates })
            }
            disabled={!name.trim() || create.isPending}
            className="w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {create.isPending ? t("share.creating") : t("share.createAndCopy")}
          </button>
        </div>

        {links && links.length > 0 && (
          <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("share.activeLinks")}
            </p>
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {link.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {link.lockedDates
                        ? t("share.lockedDates")
                        : t("share.rollingPeriod")}
                      {" · "}
                      {t("share.views", { count: link.viewCount })}
                    </p>
                  </div>
                  <button
                    type="button"
                    title={t("share.copyLink")}
                    onClick={() =>
                      link.url && copyToClipboard(link.id, link.url)
                    }
                    disabled={!link.url}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                  >
                    {copiedId === link.id ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    title={t("share.revokeLink")}
                    onClick={() => revoke.mutate({ id: link.id })}
                    disabled={revoke.isPending}
                    className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {tc("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
