import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { tauriInvoke } from "@/lib/tauri";
import type { CreateProjectInput, Project } from "@/lib/types";
import { toast } from "@/stores/toastStore";

const PRESET_COLORS = [
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#06B6D4", // cyan
];

interface ProjectFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  project?: Project | null;
}

export function ProjectForm({
  open,
  onClose,
  onSaved,
  project,
}: ProjectFormProps) {
  const { t } = useTranslation();
  const isEdit = !!project;

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [hourlyRate, setHourlyRate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kun kunder her: et projekt uden kunde er et gyldigt valg, så der er ingen
  // grund til at hente projekter ind i en kundevælger. Før stod kaldet her med
  // `.catch(console.error)`, altså en dropdown uden valg uden at sige det.
  const { clients, loadFailed, retry } = useProjectClientPicker({
    active: open,
    projects: false,
  });

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setClientId(project?.client_id ?? null);
      setHourlyRate(project?.hourly_rate?.toString() ?? "");
      setEstimatedHours(project?.estimated_hours?.toString() ?? "");
      setColor(project?.color ?? PRESET_COLORS[0]);
      setError(null);
    }
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("projects.nameRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const rate = hourlyRate ? Number.parseFloat(hourlyRate) : null;
      const estimate = estimatedHours
        ? Number.parseFloat(estimatedHours)
        : null;

      if (isEdit && project) {
        const updated: Project = {
          ...project,
          name: trimmedName,
          client_id: clientId,
          hourly_rate: rate,
          estimated_hours: estimate,
          color,
        };
        await tauriInvoke<Project>("update_project", { project: updated });
      } else {
        const input: CreateProjectInput = {
          name: trimmedName,
          client_id: clientId,
          hourly_rate: rate,
          estimated_hours: estimate,
          color,
        };
        await tauriInvoke<Project>("create_project", { input });
      }

      toast.success(
        isEdit ? t("projects.projectUpdated") : t("projects.projectCreated"),
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save project:", err);
      setError(t("projects.couldNotSaveProject"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("projects.editProject") : t("projects.newProject")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} type="button">
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            type="button"
          >
            {saving
              ? t("common.saving")
              : isEdit
                ? t("common.save")
                : t("common.create")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {loadFailed && <PickerLoadError kind={loadFailed} onRetry={retry} />}

        <Input
          label={t("form.nameRequired")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.projectNamePlaceholder")}
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="project-client"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("form.clientLabel")}
          </label>
          <select
            id="project-client"
            value={clientId ?? ""}
            onChange={(e) => setClientId(e.target.value || null)}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            <option value="">{t("form.noClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <Input
          label={t("form.hourlyRateLabel")}
          type="number"
          min="0"
          step="any"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder={t("form.inheritedRate")}
        />

        <Input
          label={t("form.estimatedHours")}
          type="number"
          min="0"
          step="0.5"
          value={estimatedHours}
          onChange={(e) => setEstimatedHours(e.target.value)}
          placeholder={t("form.estimatedHoursPlaceholder")}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-(--color-text-muted)">
            {t("form.colorLabel")}
          </span>
          <div className="flex items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t("form.selectColor", { color: c })}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full transition-all ${
                  color === c
                    ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface) scale-110"
                    : "hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}
