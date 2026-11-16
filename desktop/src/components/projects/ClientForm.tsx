import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";
import type { Client, CreateClientInput } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface ClientFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  client?: Client | null;
}

export function ClientForm({
  open,
  onClose,
  onSaved,
  client,
}: ClientFormProps) {
  const { t } = useTranslation();
  const isEdit = !!client;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [cvr, setCvr] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(client?.name ?? "");
      setEmail(client?.email ?? "");
      setPhone(client?.phone ?? "");
      setCompany(client?.company ?? "");
      setCvr(client?.cvr ?? "");
      setHourlyRate(client?.hourly_rate?.toString() ?? "");
      setNotes(client?.notes ?? "");
      setError(null);
    }
  }, [open, client]);

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

      if (isEdit && client) {
        const updated: Client = {
          ...client,
          name: trimmedName,
          email: email.trim() || null,
          phone: phone.trim() || null,
          company: company.trim() || null,
          cvr: cvr.trim() || null,
          hourly_rate: rate,
          notes: notes.trim() || null,
        };
        await tauriInvoke<Client>("update_client", { client: updated });
      } else {
        const input: CreateClientInput = {
          name: trimmedName,
          email: email.trim() || null,
          phone: phone.trim() || null,
          company: company.trim() || null,
          cvr: cvr.trim() || null,
          hourly_rate: rate,
          notes: notes.trim() || null,
        };
        await tauriInvoke<Client>("create_client", { input });
      }

      toast.success(
        isEdit ? t("projects.clientUpdated") : t("projects.clientCreated"),
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save client:", err);
      setError(t("projects.couldNotSaveClient"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("projects.editClient") : t("projects.newClient")}
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
        <Input
          label={t("form.nameRequired")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.clientNamePlaceholder")}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("common.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("form.emailPlaceholder")}
          />
          <Input
            label={t("common.phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("form.phonePlaceholder")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("form.companyLabel")}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder={t("form.companyPlaceholder")}
          />
          <Input
            label={t("form.cvrLabel")}
            value={cvr}
            onChange={(e) => setCvr(e.target.value)}
            placeholder={t("form.cvrPlaceholder")}
          />
        </div>

        <Input
          label={t("form.hourlyRateLabel")}
          type="number"
          min="0"
          step="any"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder={t("form.hourlyRatePlaceholder")}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="client-notes"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("form.notesLabel")}
          </label>
          <textarea
            id="client-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("form.notesPlaceholder")}
            rows={3}
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20 resize-none"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}
