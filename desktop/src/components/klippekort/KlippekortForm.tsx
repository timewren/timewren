import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { tauriInvoke } from "@/lib/tauri";
import type { CreateKlippekortInput, Klippekort } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface KlippekortFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  klippekort?: Klippekort | null;
}

export function KlippekortForm({
  open,
  onClose,
  onSaved,
  klippekort,
}: KlippekortFormProps) {
  const { t } = useTranslation();
  const isEdit = !!klippekort;
  // Påkrævede felte er mærket med en stjerne — samme tegn i alle sprog, så
  // mærket følger etiketten i stedet for at være dansk tekst i markup'en.
  const krav = t("common.requiredMark");

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [totalHours, setTotalHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Én hentning for begge valg, ét sæt fejl-tilstand: et klippekort kan høre
  // til en kunde uden projekt, så de to lister hører sammen. Før stod de her
  // med `.catch(console.error)`, altså en dropdown uden valg uden at sige det.
  // Hentningen er doven, fordi formularen kun skal have lister mens den er åben.
  const { projects, clients, loadFailed, retry } = useProjectClientPicker({
    active: open,
  });

  useEffect(() => {
    if (open) {
      setName(klippekort?.name ?? "");
      setClientId(klippekort?.client_id ?? "");
      setProjectId(klippekort?.project_id ?? null);
      setTotalHours(klippekort?.total_hours?.toString() ?? "");
      setHourlyRate(klippekort?.hourly_rate?.toString() ?? "");
      setExpiresAt(
        klippekort?.expires_at ? klippekort.expires_at.substring(0, 10) : "",
      );
      setError(null);
    }
  }, [open, klippekort]);

  const filteredProjects = clientId
    ? projects.filter((p) => p.client_id === clientId || !p.client_id)
    : projects;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("projects.nameRequired"));
      return;
    }
    if (!clientId) {
      setError(t("klippekort.clientRequired"));
      return;
    }
    const hours = Number.parseFloat(totalHours);
    if (!hours || hours <= 0) {
      setError(t("klippekort.totalHoursRequired"));
      return;
    }
    const rate = Number.parseFloat(hourlyRate);
    if (!rate || rate <= 0) {
      setError(t("klippekort.rateRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEdit && klippekort) {
        const updated: Klippekort = {
          ...klippekort,
          name: trimmedName,
          client_id: clientId,
          project_id: projectId,
          total_hours: hours,
          hourly_rate: rate,
          expires_at: expiresAt || null,
        };
        await tauriInvoke<Klippekort>("update_klippekort", {
          klippekort: updated,
        });
      } else {
        const input: CreateKlippekortInput = {
          name: trimmedName,
          client_id: clientId,
          project_id: projectId,
          total_hours: hours,
          hourly_rate: rate,
          expires_at: expiresAt || null,
        };
        await tauriInvoke<Klippekort>("create_klippekort", { input });
      }

      toast.success(
        isEdit
          ? t("klippekort.klippekortUpdated")
          : t("klippekort.klippekortCreated"),
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save klippekort:", err);
      setError(t("klippekort.couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    name.trim() &&
    clientId &&
    Number.parseFloat(totalHours) > 0 &&
    Number.parseFloat(hourlyRate) > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("klippekort.edit") : t("klippekort.new")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} type="button">
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
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
          placeholder={t("klippekort.namePlaceholder")}
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="kk-client"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("form.clientLabel")} {krav}
          </label>
          <select
            id="kk-client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId(null);
            }}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            <option value="">{t("klippekort.selectClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="kk-project"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("timeEntry.project")}
          </label>
          <select
            id="kk-project"
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            <option value="">{t("klippekort.noSpecificProject")}</option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`${t("klippekort.totalHours")} ${krav}`}
            type="number"
            min="0.5"
            step="0.5"
            value={totalHours}
            onChange={(e) => setTotalHours(e.target.value)}
            placeholder={t("klippekort.hoursPlaceholder")}
          />

          <Input
            label={`${t("klippekort.rateLabel")} ${krav}`}
            type="number"
            min="0"
            step="any"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            placeholder={t("klippekort.ratePlaceholder")}
          />
        </div>

        <Input
          label={t("klippekort.expiresAt")}
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />

        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}
