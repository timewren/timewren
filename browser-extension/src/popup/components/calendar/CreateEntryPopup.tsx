import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../../api/client";
import { offlineClient } from "../../../api/offlineClient";
import { useAutoPrepaid } from "../../../hooks/useAutoPrepaid";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { toIntlLocale, useT } from "../../../i18n";
import { userErrorMessage } from "../../../lib/api-error";
import { resolveCreateTimes } from "../../../lib/edit-entry";
import { formatHoursShort } from "../../../lib/format-hours";
import {
  type PrepaidChoice,
  resolvePrepaidPackage,
} from "../../../lib/prepaid";
import { invalidateEntryQueries } from "../../../lib/query-invalidation";
import { useAuthStore } from "../../../stores/authStore";
import { formatMinutesOfDay } from "../../../utils/calendar-math";
import { minutesToDate, toLocalDateStr } from "../../utils/calendar-math";
import { PrepaidSelect } from "../PrepaidSelect";
import { ClientRadioList } from "./ClientRadioList";

interface CreateEntryPopupProps {
  date: Date;
  startMinutes: number;
  endMinutes: number;
  onClose: () => void;
}

function formatTimeRange(date: Date, startMin: number, endMin: number): string {
  const start = minutesToDate(date, startMin);
  const end = minutesToDate(date, endMin);
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${fmt(start)}–${fmt(end)}`;
}

export function CreateEntryPopup({
  date,
  startMinutes,
  endMinutes,
  onClose,
}: CreateEntryPopupProps) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [description, setDescription] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [startTime, setStartTime] = useState(formatMinutesOfDay(startMinutes));
  // Slut 24:00 kan ikke stå i et tidsfelt; 00:00 efter en start er midnat
  const [endTime, setEndTime] = useState(
    formatMinutesOfDay(endMinutes >= 24 * 60 ? 0 : endMinutes),
  );
  const times = resolveCreateTimes(startTime, endTime);
  const fieldId = useId();
  const dialogRef = useModalDialog(onClose);

  // Klippekort som i Timer og Hurtig registrering: kundens auto-kort
  // foreslås, et andet kort eller intet træk kan vælges.
  const { packagesForClient } = useAutoPrepaid(selectedClientId);
  const [prepaidChoice, setPrepaidChoice] = useState<PrepaidChoice>({
    mode: "auto",
  });
  const prepaidPackageId =
    resolvePrepaidPackage(prepaidChoice, packagesForClient, selectedClientId)
      .pkg?.id ?? null;

  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded,
  });

  const createMutation = useMutation({
    // offlineClient queues the entry when offline instead of throwing/losing it.
    mutationFn: offlineClient.createTimeEntry,
    onSuccess: () => {
      invalidateEntryQueries(queryClient);
      onClose();
    },
  });

  const startMin = times.ok ? times.startMinutes : startMinutes;
  const endMin = times.ok ? times.endMinutes : endMinutes;
  const hours = Math.max(0.01, (endMin - startMin) / 60);
  const dateStr = toLocalDateStr(date);

  // Sort clients by timeEntryCount (most used first)
  const sortedClients = useMemo(() => {
    if (!projectsData?.clients) return [];
    return [...projectsData.clients].sort(
      (a, b) => (b.timeEntryCount ?? 0) - (a.timeEntryCount ?? 0),
    );
  }, [projectsData?.clients]);

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!clientSearch) return sortedClients;
    const q = clientSearch.toLowerCase();
    return sortedClients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q),
    );
  }, [sortedClients, clientSearch]);

  // Projects for selected client
  const clientProjects = useMemo(() => {
    if (!selectedClientId || !projectsData?.projects) return [];
    return projectsData.projects.filter(
      (p) => p.clientId === selectedClientId && p.status === "active",
    );
  }, [selectedClientId, projectsData?.projects]);

  // Auto-select single project, reset when client changes
  useEffect(() => {
    if (clientProjects.length === 1) {
      setSelectedProjectId(clientProjects[0].id);
    } else {
      setSelectedProjectId(null);
    }
  }, [clientProjects]);

  const handleClientSelect = (clientId: string | null) => {
    // Ny kunde → klippekort-valget hører til den gamle og nulstilles
    if (clientId !== selectedClientId) setPrepaidChoice({ mode: "auto" });
    setSelectedClientId(clientId);
    setSelectedProjectId(null);
  };

  const needsDescription = !selectedClientId && !selectedProjectId;
  const canSubmit =
    !createMutation.isPending &&
    times.ok &&
    (!needsDescription || !!description.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const start = minutesToDate(date, startMin);
    const end = minutesToDate(date, endMin);
    createMutation.mutate({
      projectId: selectedProjectId || undefined,
      clientId: selectedClientId || undefined,
      hours,
      description: description || `${formatTimeRange(date, startMin, endMin)}`,
      date: dateStr,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      prepaidPackageId: selectedClientId ? prepaidPackageId : null,
    });
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: klik på baggrunden lukker; tastaturet bruger Esc (useModalDialog)
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-end justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-titel`}
        className="w-full max-h-full overflow-y-auto bg-[var(--color-surface-elevated)] rounded-t-[14px] animate-slide-up shadow-xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <div>
            <h2
              id={`${fieldId}-titel`}
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              {t("entry.create.title")}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock
                size={12}
                aria-hidden="true"
                className="text-[var(--color-text-muted)]"
              />
              <p className="text-xs text-[var(--color-text-secondary)]">
                {date.toLocaleDateString(toIntlLocale(locale), {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
                , {formatHoursShort(hours)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
            aria-label={t("entry.form.close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <ClientRadioList
            clients={filteredClients}
            projects={projectsData?.projects ?? []}
            selectedClientId={selectedClientId}
            onSelect={handleClientSelect}
            search={clientSearch}
            onSearchChange={setClientSearch}
            autoFocusSearch
          />

          {/* Project selector - only when client with projects is selected */}
          {selectedClientId && clientProjects.length > 0 && (
            <div>
              <label
                htmlFor={`${fieldId}-projekt`}
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                {t("entry.form.projectOptional")}
              </label>
              <select
                id={`${fieldId}-projekt`}
                value={selectedProjectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                className="tt-select w-full"
              >
                <option value="">{t("entry.form.noProject")}</option>
                {clientProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Klippekort — vises når kunden har aktive kort */}
          {selectedClientId && packagesForClient.length > 0 && (
            <PrepaidSelect
              packages={packagesForClient}
              clientId={selectedClientId}
              choice={prepaidChoice}
              onChange={setPrepaidChoice}
            />
          )}

          {/* Description */}
          <div>
            <label
              htmlFor={`${fieldId}-beskrivelse`}
              className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
            >
              {t("entry.form.description")}
            </label>
            <input
              id={`${fieldId}-beskrivelse`}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                needsDescription
                  ? t("entry.form.descriptionRequiredInternal")
                  : t("entry.form.descriptionOptional")
              }
              className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm placeholder:text-[var(--color-text-muted)] transition-colors"
            />
          </div>

          {/* Starttid og sluttid */}
          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label
                  htmlFor={`${fieldId}-start`}
                  className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
                >
                  {t("entry.form.startTime")}
                </label>
                <input
                  id={`${fieldId}-start`}
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step="900"
                  aria-invalid={!times.ok}
                  className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor={`${fieldId}-slut`}
                  className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
                >
                  {t("entry.form.endTime")}
                </label>
                <input
                  id={`${fieldId}-slut`}
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  step="900"
                  aria-invalid={!times.ok}
                  className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                />
              </div>
            </div>
            {!times.ok && (
              <p className="mt-1 text-xs text-red-700" role="alert">
                {times.error}
              </p>
            )}
          </div>

          {/* Error */}
          {createMutation.error && (
            <p className="text-xs text-red-700 text-center" role="alert">
              {userErrorMessage(createMutation.error, t("entry.create.failed"))}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-surface-sunken)] transition-colors"
            >
              {t("entry.form.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 py-2 bg-primary-600 text-[var(--color-on-primary)] text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending
                ? t("entry.create.creating")
                : t("entry.create.create")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
