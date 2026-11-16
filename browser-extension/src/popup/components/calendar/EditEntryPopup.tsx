import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../../api/client";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { useT } from "../../../i18n";
import { userErrorMessage } from "../../../lib/api-error";
import { isoToTimeStr, resolveEditTimes } from "../../../lib/edit-entry";
import { formatHoursShort } from "../../../lib/format-hours";
import { invalidateEntryQueries } from "../../../lib/query-invalidation";
import { useAuthStore } from "../../../stores/authStore";
import { ClientRadioList } from "./ClientRadioList";

interface EditEntryPopupProps {
  entry: {
    id: string;
    description: string;
    hours: number;
    date: string;
    startTime: string | null;
    endTime: string | null;
    projectName: string | null;
    clientName: string | null;
    clientId: string | null;
    projectId: string | null;
  };
  onClose: () => void;
}

export function EditEntryPopup({ entry, onClose }: EditEntryPopupProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    entry.clientId,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    entry.projectId,
  );
  const [description, setDescription] = useState(entry.description || "");
  const [startTime, setStartTime] = useState(isoToTimeStr(entry.startTime));
  const [endTime, setEndTime] = useState(isoToTimeStr(entry.endTime));
  // Poster uden tidspunkt rettes på timetallet
  const [hoursInput, setHoursInput] = useState(
    String(entry.hours).replace(".", ","),
  );
  const [clientSearch, setClientSearch] = useState("");
  const fieldId = useId();
  const dialogRef = useModalDialog(onClose);

  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded,
  });

  const updateMutation = useMutation({
    mutationFn: apiClient.updateTimeEntry,
    onSuccess: () => {
      // Serveren flytter/genberegner et evt. klippekort-træk
      invalidateEntryQueries(queryClient);
      onClose();
    },
  });

  const times = resolveEditTimes({
    date: entry.date,
    originalStart: entry.startTime,
    originalEnd: entry.endTime,
    originalHours: entry.hours,
    start: startTime,
    end: endTime,
    hoursInput,
  });
  const hours = times.ok ? times.hours : entry.hours;
  // Timetal-feltet kun for poster uden tidspunkter: tider kan ikke fjernes
  const showHoursInput =
    (!startTime || !endTime) && !entry.startTime && !entry.endTime;

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

  // Only auto-select/reset the project when the user actually changes the
  // client — NOT when projectsData arrives asynchronously. Keying on the
  // client id (seeded with the entry's own client) preserves the entry's
  // existing project on open; a render-count guard would be defeated by the
  // async load and wipe the project for clients with multiple projects.
  const prevClientId = useRef(entry.clientId);
  useEffect(() => {
    if (selectedClientId === prevClientId.current) return;
    prevClientId.current = selectedClientId;
    if (clientProjects.length === 1) {
      setSelectedProjectId(clientProjects[0].id);
    } else {
      setSelectedProjectId(null);
    }
  }, [selectedClientId, clientProjects]);

  const handleClientSelect = (clientId: string | null) => {
    setSelectedClientId(clientId);
    setSelectedProjectId(null);
  };

  const canSubmit =
    !updateMutation.isPending &&
    times.ok &&
    hours > 0 &&
    (!!description.trim() || !!selectedClientId || !!selectedProjectId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !times.ok) return;

    // Kun ændrede tider sendes (se resolveEditTimes)
    updateMutation.mutate({
      id: entry.id,
      hours: times.hours,
      date: entry.date,
      description,
      startTime: times.startTime,
      endTime: times.endTime,
      projectId: selectedProjectId,
      clientId: selectedClientId,
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
          <h2
            id={`${fieldId}-titel`}
            className="text-sm font-semibold text-[var(--color-text-primary)]"
          >
            {t("entry.edit.title")}
          </h2>
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
              placeholder={t("entry.form.descriptionOptional")}
              className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm placeholder:text-[var(--color-text-muted)] transition-colors"
            />
          </div>

          {/* Time inputs */}
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
                  className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                />
              </div>
              {showHoursInput ? (
                <label className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={hoursInput}
                    onChange={(e) => setHoursInput(e.target.value)}
                    aria-label={t("entry.form.hours")}
                    className="w-14 px-2 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  {t("entry.form.hoursUnit")}
                </label>
              ) : (
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-surface-sunken)] px-2 py-1.5 rounded-lg">
                  <Clock size={12} aria-hidden="true" />
                  <span className="font-medium">{formatHoursShort(hours)}</span>
                </div>
              )}
            </div>
            {showHoursInput && !entry.startTime && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t("entry.edit.untimedHint")}
              </p>
            )}
            {!times.ok && (
              <p className="mt-1 text-xs text-red-700" role="alert">
                {times.error}
              </p>
            )}
          </div>

          {/* Error */}
          {updateMutation.error && (
            <p className="text-xs text-red-700 text-center" role="alert">
              {userErrorMessage(updateMutation.error, t("entry.edit.failed"))}
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
              {updateMutation.isPending
                ? t("entry.edit.saving")
                : t("entry.edit.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
