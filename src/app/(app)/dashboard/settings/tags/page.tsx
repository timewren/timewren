"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { trpc } from "@/providers/trpc-provider";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export default function TagsSettingsPage() {
  const fid = useId();
  const t = useTranslations("settingsTags");
  const utils = trpc.useUtils();
  const { data: tags } = trpc.tags.list.useQuery();
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[9]);

  const create = trpc.tags.create.useMutation({
    onSuccess: () => {
      toast.success(t("created"));
      utils.tags.list.invalidate();
      setName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.tags.delete.useMutation({
    onSuccess: () => {
      toast.success(t("deleted"));
      utils.tags.list.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Create new tag */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("createTitle")}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label
              htmlFor={`${fid}-f1`}
              className="text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("name")}
            </label>
            <input
              id={`${fid}-f1`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("color")}
            </span>
            <div className="mt-1 flex gap-1">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition-all ${
                    color === c ? "ring-2 ring-gray-400 ring-offset-2" : ""
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={t("colorOption", { color: c })}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => create.mutate({ name, color })}
            disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t("create")}
          </button>
        </div>
      </div>

      {/* Tag list */}
      <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="p-3">{t("colTag")}</th>
              <th className="p-3">{t("colUsage")}</th>
              <th className="p-3 text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {tags?.map((tag) => (
              <tr
                key={tag.id}
                className="border-b border-gray-100 last:border-b-0 dark:border-gray-800/50"
              >
                <td className="p-3">
                  <span
                    className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                      borderLeft: `3px solid ${tag.color}`,
                    }}
                  >
                    {tag.name}
                  </span>
                </td>
                <td className="p-3 text-xs text-gray-500 dark:text-gray-400">
                  {t("usage", {
                    entries: tag.usage.entries,
                    projects: tag.usage.projects,
                    clients: tag.usage.clients,
                  })}
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t("confirmDelete", { name: tag.name }))) {
                        del.mutate({ id: tag.id });
                      }
                    }}
                    className="text-red-500 hover:text-red-700"
                    aria-label={t("delete", { name: tag.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {(!tags || tags.length === 0) && (
              <tr>
                <td
                  colSpan={3}
                  className="p-6 text-center text-sm text-gray-400"
                >
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
