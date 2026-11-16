import { Building2, Check, Clock, Search } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useT } from "../../../i18n";
import type { Client, Project } from "../../../types";

interface ClientRadioListProps {
  /** Allerede sorteret og filtreret efter søgningen */
  clients: Client[];
  projects: Project[];
  selectedClientId: string | null;
  onSelect: (clientId: string | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** Søgefeltet får fokus, når dialogen åbner (useModalDialog) */
  autoFocusSearch?: boolean;
}

/**
 * Kundevalg i Ny og Rediger registrering: rigtige radioknapper (piletaster,
 * skærmlæser siger "valgt"), og den valgte række har både hak og fed tekst,
 * så valget ikke kun vises med en svag baggrund.
 */
export function ClientRadioList({
  clients,
  projects,
  selectedClientId,
  onSelect,
  search,
  onSearchChange,
  autoFocusSearch = false,
}: ClientRadioListProps) {
  const { t } = useT();
  const id = useId();
  const name = `${id}-kunde`;
  const labelId = `${id}-label`;

  const option = (
    value: string | null,
    isSelected: boolean,
    content: ReactNode,
  ) => (
    <label
      key={value ?? "intern"}
      className={`relative flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--color-fokus)] ${
        isSelected ? "bg-primary-50" : "hover:bg-[var(--color-surface-sunken)]"
      }`}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={isSelected}
        onChange={() => onSelect(value)}
      />
      <span
        aria-hidden="true"
        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          isSelected
            ? "border-primary-600 bg-primary-600"
            : "border-[var(--color-border-strong)]"
        }`}
      >
        {isSelected && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-on-primary)]" />
        )}
      </span>
      {content}
      {isSelected && (
        <Check
          size={14}
          className="ml-auto text-primary-600 flex-shrink-0"
          aria-hidden="true"
        />
      )}
    </label>
  );

  return (
    <div>
      <p
        id={labelId}
        className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
      >
        {t("entry.radio.client")}
      </p>

      <div className="relative mb-2">
        <Search
          size={14}
          aria-hidden="true"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("entry.radio.searchPlaceholder")}
          aria-label={t("entry.radio.searchLabel")}
          data-autofocus={autoFocusSearch ? "" : undefined}
          className="w-full pl-8 pr-3 py-1.5 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm placeholder:text-[var(--color-text-muted)] transition-colors"
        />
      </div>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="border border-[var(--color-border-default)] rounded-lg overflow-hidden"
      >
        <div className="max-h-[160px] overflow-y-auto">
          {/* Intern tid står altid først */}
          {!search &&
            option(
              null,
              selectedClientId === null,
              <>
                <Clock
                  size={14}
                  aria-hidden="true"
                  className="text-[var(--color-text-muted)] flex-shrink-0"
                />
                <span
                  className={`text-sm text-[var(--color-text-primary)] ${
                    selectedClientId === null ? "font-semibold" : ""
                  }`}
                >
                  {t("entry.radio.internal")}
                </span>
              </>,
            )}

          {clients.map((client) => {
            const isSelected = selectedClientId === client.id;
            const projectCount = projects.filter(
              (p) => p.clientId === client.id && p.status === "active",
            ).length;
            return option(
              client.id,
              isSelected,
              <>
                <Building2
                  size={14}
                  aria-hidden="true"
                  className="text-[var(--color-text-muted)] flex-shrink-0"
                />
                <span
                  className={`text-sm text-[var(--color-text-primary)] truncate flex-1 ${
                    isSelected ? "font-semibold" : ""
                  }`}
                >
                  {client.name}
                </span>
                {projectCount > 0 && (
                  <span className="text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {t("entry.radio.projects", { count: projectCount })}
                  </span>
                )}
              </>,
            );
          })}

          {clients.length === 0 && search && (
            <div className="py-4 text-center">
              <p className="text-xs text-[var(--color-text-muted)]">
                {t("entry.radio.noMatch", { search })}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
