import { Clock, CreditCard, DollarSign, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { formatCurrency, formatHours } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Klippekort } from "@/lib/types";
import { KlippekortCard } from "./KlippekortCard";
import { KlippekortForm } from "./KlippekortForm";

type FilterTab = "alle" | "active" | "expired" | "depleted";

export function KlippekortList() {
  const { t } = useTranslation();

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "alle", label: t("klippekort.all") },
    { key: "active", label: t("klippekort.active") },
    { key: "expired", label: t("klippekort.expired") },
    { key: "depleted", label: t("klippekort.depleted") },
  ];
  const [klippekort, setKlippekort] = useState<Klippekort[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("alle");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Klippekort | null>(null);

  const fetchKlippekort = useCallback(async () => {
    try {
      const result = await tauriInvoke<Klippekort[]>("list_klippekort", {
        includeInactive: true,
      });
      setKlippekort(result);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch klippekort:", err);
      setLoadFailed(true);
      setKlippekort([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKlippekort();
  }, [fetchKlippekort]);

  const filtered = useMemo(() => {
    let items = klippekort;

    // Tab filter
    if (tab !== "alle") {
      items = items.filter((k) => k.status === tab);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          k.client_name?.toLowerCase().includes(q) ||
          k.project_name?.toLowerCase().includes(q),
      );
    }

    return items;
  }, [klippekort, tab, search]);

  // Summary stats (only active klippekort)
  const stats = useMemo(() => {
    const active = klippekort.filter((k) => k.status === "active");
    const totalRemaining = active.reduce(
      (sum, k) => sum + Math.max(0, k.total_hours - k.used_hours),
      0,
    );
    const totalValue = active.reduce(
      (sum, k) =>
        sum + Math.max(0, k.total_hours - k.used_hours) * k.hourly_rate,
      0,
    );
    return {
      activeCount: active.length,
      totalRemaining,
      totalValue,
    };
  }, [klippekort]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(kk: Klippekort) {
    setEditing(kk);
    setFormOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
            <CreditCard size={14} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {stats.activeCount}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("klippekort.activeKlippekort")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15">
            <Clock size={14} className="text-blue-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {formatHours(stats.totalRemaining)} {t("common.hours")}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("klippekort.remainingHours")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
            <DollarSign size={14} className="text-violet-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-(--color-text) font-mono leading-none">
              {formatCurrency(Math.round(stats.totalValue), 0)}
            </p>
            <p className="text-[10px] text-(--color-text-muted) mt-0.5">
              {t("klippekort.remainingValue")}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
          />
          <input
            type="text"
            aria-label={t("klippekort.searchKlippekort")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("klippekort.searchKlippekort")}
            className="h-9 w-full rounded-md border border-(--color-border) bg-(--color-bg) pl-9 pr-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          />
        </div>

        <Button size="sm" onClick={openCreate}>
          <Plus size={14} />
          {t("klippekort.new")}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-(--color-bg) p-1 border border-(--color-border)">
        {TABS.map((t) => {
          const count =
            t.key === "alle"
              ? klippekort.length
              : klippekort.filter((k) => k.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-(--color-surface) text-(--color-text) shadow-sm"
                  : "text-(--color-text-muted) hover:text-(--color-text)"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {loadFailed ? (
        <LoadError
          message={t("klippekort.loadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchKlippekort();
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasKlippekort={klippekort.length > 0}
          onCreateClick={openCreate}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((kk) => (
            <KlippekortCard key={kk.id} klippekort={kk} onClick={openEdit} />
          ))}
        </div>
      )}

      {/* Form dialog */}
      <KlippekortForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchKlippekort}
        klippekort={editing}
      />
    </div>
  );
}

function EmptyState({
  hasKlippekort,
  onCreateClick,
}: {
  hasKlippekort: boolean;
  onCreateClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--color-border)/40 mb-4">
        <CreditCard size={22} className="text-(--color-text-muted)" />
      </div>
      <h3 className="text-sm font-medium text-(--color-text) mb-1">
        {hasKlippekort ? t("common.noResults") : t("klippekort.noKlippekort")}
      </h3>
      <p className="text-xs text-(--color-text-muted) mb-4 max-w-[240px]">
        {hasKlippekort
          ? t("projects.noResultsFilter")
          : t("klippekort.createFirst")}
      </p>
      {!hasKlippekort && (
        <Button size="sm" onClick={onCreateClick}>
          <Plus size={14} />
          {t("klippekort.new")}
        </Button>
      )}
    </div>
  );
}
