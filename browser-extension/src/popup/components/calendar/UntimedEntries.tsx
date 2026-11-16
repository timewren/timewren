import { useT } from "../../../i18n";
import { formatHoursShort } from "../../../lib/format-hours";

interface UntimedEntry {
  id: string;
  hours: number;
  description: string;
  clientName: string | null;
  projectName: string | null;
}

interface UntimedEntriesProps<T extends UntimedEntry> {
  entries: T[];
  onSelect: (entry: T) => void;
  /** Kompakt visning til ugekalenderens smalle dagskolonner */
  compact?: boolean;
}

/**
 * Registreringer uden start- og sluttid (fx fra Hurtig registrering) har
 * ingen plads i tidsgitteret. De vises her pr. dag, så de kan åbnes, rettes
 * og slettes som alle andre.
 */
export function UntimedEntries<T extends UntimedEntry>({
  entries,
  onSelect,
  compact = false,
}: UntimedEntriesProps<T>) {
  const { t } = useT();
  if (entries.length === 0) return null;

  return (
    <ul className={compact ? "space-y-0.5" : "space-y-1"}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onSelect(entry)}
            className={`w-full flex items-center gap-1.5 text-left rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] hover:border-[var(--color-text-muted)] transition-colors ${
              compact ? "px-1.5 py-0.5" : "px-2 py-1"
            }`}
            title={t("entry.untimed.open")}
          >
            <span
              className={`flex-1 min-w-0 truncate text-[var(--color-text-primary)] ${
                compact ? "text-[10px]" : "text-xs"
              }`}
            >
              {entry.clientName || t("views.calendar.internal")}
              {!compact && (entry.projectName || entry.description) && (
                <span className="text-[var(--color-text-muted)]">
                  , {entry.projectName || entry.description}
                </span>
              )}
            </span>
            <span
              className={`font-medium text-[var(--color-text-tertiary)] whitespace-nowrap ${
                compact ? "text-[10px]" : "text-xs"
              }`}
            >
              {formatHoursShort(entry.hours)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
