"use client";

import { Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

interface ProjectActivityTypesSectionProps {
  projectId: string;
}

/**
 * Enterprise (#459): hvilke aktivitetstyper der må registreres på projektet
 * i ugegrid'et. Ingen valgte = alle org'ens aktive typer. Kun admin/owner.
 */
export function ProjectActivityTypesSection({
  projectId,
}: ProjectActivityTypesSectionProps) {
  const t = useTranslations("projects");
  const utils = trpc.useUtils();
  const { data: types, isLoading: typesLoading } =
    trpc.enterprise.listActivityTypes.useQuery();
  const { data, isLoading } = trpc.enterprise.listProjectActivityTypes.useQuery(
    { projectId },
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setSelected(data.activityTypeIds);
  }, [data, dirty]);

  const save = trpc.enterprise.setProjectActivityTypes.useMutation({
    onSuccess: (res) => {
      setDirty(false);
      utils.enterprise.listProjectActivityTypes.invalidate({ projectId });
      utils.enterprise.getTimesheetWeek.invalidate();
      toast.success(
        res.count === 0
          ? t("activityTypes.allowedAll")
          : t("activityTypes.allowedCount", { count: res.count }),
      );
    },
    onError: (e) => toast.error(e.message || t("activityTypes.saveFailed")),
  });

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setDirty(true);
  };

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center gap-2">
        <Tags className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("activityTypes.title")}
        </h2>
      </div>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {t("activityTypes.description")}
      </p>

      {typesLoading || isLoading ? (
        <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      ) : (types?.length ?? 0) === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("activityTypes.none")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {types?.map((type) => {
              const checked = selected.includes(type.id);
              return (
                <label
                  key={type.id}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                    checked
                      ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggle(type.id)}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: type.color }}
                    aria-hidden="true"
                  />
                  {type.name}
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({ projectId, activityTypeIds: selected })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              {save.isPending
                ? t("activityTypes.saving")
                : t("activityTypes.save")}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selected.length === 0
                ? t("activityTypes.allAllowedHint")
                : t("activityTypes.selectedOf", {
                    selected: selected.length,
                    total: types?.length ?? 0,
                  })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
