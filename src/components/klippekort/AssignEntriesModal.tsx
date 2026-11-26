"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatDuration } from "@/lib/format";
import { MAX_PREPAID_ASSIGN_SELECTION } from "@/lib/prepaid/bulk-assign";
import {
  maxPrepaidDeductionHours,
  normalizePrepaidDeductionHours,
  roundPrepaidHours,
} from "@/lib/prepaid/hours";
import { trpc } from "@/providers/trpc-provider";

// time_entries.hours er numeric(5,2): én postering kan højst være 999,99 t.
const MAX_ENTRY_HOURS_CENTS = 99999;
const EMPTY_FILTERS = {
  includeOtherCards: false,
  projectId: "",
  from: "",
  to: "",
};

interface AssignEntriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  packageId: string;
  packageName: string;
  remainingHours: number;
  clipSizeMinutes: number | null;
  overdraftPolicy: string;
  onAssigned: () => void;
  timeEntryIds?: string[];
}

export function AssignEntriesModal({
  isOpen,
  onClose,
  packageId,
  packageName,
  remainingHours,
  clipSizeMinutes,
  overdraftPolicy,
  onAssigned,
  timeEntryIds,
}: AssignEntriesModalProps) {
  const t = useTranslations("klippekort");
  const tc = useTranslations("common");
  const columns = useTranslations("reports.columns");
  const dates = useTranslations("reports.toolbar");
  const tt = useTranslations("time");
  const duration = useTranslations("home.duration");
  const showDuration = (hours: number) =>
    formatDuration(hours, {
      h: duration("hourUnit"),
      min: duration("minUnit"),
    });
  const locale = toIntlLocale(useLocale());
  const showBalanceHours = (hours: number) =>
    hours >= 0 && Math.round(hours * 60) / 60 === hours
      ? showDuration(hours)
      : `${hours.toLocaleString(locale, { maximumFractionDigits: 2 })} ${duration("hourUnit")}`;
  const filterId = useId();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);

  const invalidDates = !!(
    filters.from &&
    filters.to &&
    filters.from > filters.to
  );
  const { data: clientProjects, isError: projectError } =
    trpc.prepaid.getAssignableProjects.useQuery(
      { packageId, includeOtherCards: filters.includeOtherCards },
      { enabled: isOpen && !timeEntryIds },
    );
  const { data, isLoading, isError } =
    trpc.prepaid.getAssignableEntries.useQuery(
      {
        packageId,
        limit: MAX_PREPAID_ASSIGN_SELECTION + 1,
        offset: page * MAX_PREPAID_ASSIGN_SELECTION,
        timeEntryIds,
        includeOtherCards: Boolean(timeEntryIds) || filters.includeOtherCards,
        projectId: filters.projectId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      },
      { enabled: isOpen && !invalidDates },
    );
  const entries =
    invalidDates || isError
      ? []
      : (data ?? []).slice(0, MAX_PREPAID_ASSIGN_SELECTION);
  const incompleteSelection =
    timeEntryIds !== undefined && entries.length !== timeEntryIds.length;
  const selectedEntries = entries.filter((entry) =>
    timeEntryIds
      ? entry.prepaidPackageId !== packageId
      : selected.has(entry.id),
  );
  const selectedHours = selectedEntries.reduce(
    (sum, entry) => sum + entry.hours,
    0,
  );
  let deduction = 0;
  let balanceAfter = remainingHours;
  let unlinkedHours = 0;
  let invoiceHours = 0;
  const sources = new Map<
    string,
    {
      name: string;
      reversed: number;
      deducted: number;
      invoiceReversed: number;
      invoiced: number;
    }
  >();
  for (const entry of selectedEntries) {
    const cost = normalizePrepaidDeductionHours(entry.hours, clipSizeMinutes);
    deduction += cost;
    const invoiced = overdraftPolicy === "invoice" && cost > balanceAfter;
    if (!invoiced) {
      balanceAfter = Math.max(0, roundPrepaidHours(balanceAfter - cost));
    }
    if (entry.prepaidPackageId && entry.prepaidPackageName !== null) {
      const source = sources.get(entry.prepaidPackageId) ?? {
        name: entry.prepaidPackageName,
        reversed: 0,
        deducted: 0,
        invoiceReversed: 0,
        invoiced: 0,
      };
      if (invoiced) {
        source.invoiceReversed += entry.prepaidHoursRestored;
        source.invoiced += entry.hours;
      } else {
        source.reversed += entry.prepaidHoursRestored;
        source.deducted += cost;
      }
      sources.set(entry.prepaidPackageId, source);
    } else if (invoiced) {
      invoiceHours += entry.hours;
    } else {
      unlinkedHours += entry.hours;
    }
  }
  deduction = roundPrepaidHours(deduction);
  const exceedsBalance = deduction > remainingHours;
  const blocked = exceedsBalance && overdraftPolicy === "block";
  // Ét klip efter serverens afrunding (ceil af klip/60 gav 0,01 t for meget
  // ved fx 132-min klip).
  const minimumClipDeduction =
    clipSizeMinutes && clipSizeMinutes > 0
      ? normalizePrepaidDeductionHours(0.01, clipSizeMinutes)
      : 0;
  // Den længste enkeltpostering (registreringer gemmes i hundrededele af en
  // time), som serverens afrunding pr. postering kan dække af saldoen.
  const largestPostingHours =
    blocked && clipSizeMinutes && clipSizeMinutes > 0
      ? Math.min(
          maxPrepaidDeductionHours(remainingHours, clipSizeMinutes),
          MAX_ENTRY_HOURS_CENTS / 100,
        )
      : 0;
  const needsReview =
    sources.size > 0 || (exceedsBalance && overdraftPolicy === "invoice");

  const reset = useCallback(() => {
    setSelected(new Set());
    setFilters(EMPTY_FILTERS);
    setPage(0);
    setReviewing(false);
  }, []);
  const utils = trpc.useUtils();
  const assignMutation = trpc.prepaid.bulkAssignEntries.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.remainingHours !== null
          ? t("assignedWithBalance", {
              count: result.assigned,
              name: result.packageName,
              balance: showDuration(result.remainingHours),
            })
          : t("assigned", { count: result.assigned, name: result.packageName }),
      );
      if (result.overflowed > 0) {
        toast.warning(t("overflowed", { count: result.overflowed }));
      }
      reset();
      utils.prepaid.invalidate();
      utils.time.invalidate();
      onAssigned();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || t("assign.failed"));
    },
  });

  const focusReview = useCallback((node: HTMLUListElement | null) => {
    node?.focus();
  }, []);

  const handleClose = useCallback(() => {
    if (assignMutation.isPending) return;
    reset();
    onClose();
  }, [assignMutation.isPending, onClose, reset]);

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    setSelected(new Set());
  };

  const updateFilters = (update: Partial<typeof EMPTY_FILTERS>) => {
    setFilters((previous) => ({ ...previous, ...update }));
    changePage(0);
  };

  const toggle = (id: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = () => {
    if (!reviewing && needsReview) {
      setReviewing(true);
      return;
    }
    assignMutation.mutate({
      packageId,
      timeEntryIds: timeEntryIds ?? selectedEntries.map((entry) => entry.id),
    });
  };

  const allSelected = selectedEntries.length === entries.length;
  const limited = (data?.length ?? 0) > MAX_PREPAID_ASSIGN_SELECTION;
  const filteredProject =
    filters.projectId &&
    clientProjects?.find((project) => project.id === filters.projectId);
  const formatHours = (hours: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hours);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t(reviewing ? "assign.reviewMove" : "assign.title")}
      description={
        reviewing
          ? t("assignedTimeStaysOnProject")
          : timeEntryIds
            ? `${t("assign.selectedDescription", { name: packageName })} ${t("assignedTimeStaysOnProject")}`
            : `${t("assign.description", { name: packageName })} ${t("assignedTimeStaysOnProject")}`
      }
      size={timeEntryIds ? "md" : "full"}
      closeOnEscape={!assignMutation.isPending}
      closeOnOverlayClick={!assignMutation.isPending}
      showCloseButton={!assignMutation.isPending}
    >
      {reviewing ? (
        <ul
          ref={focusReview}
          tabIndex={-1}
          className="mb-4 list-disc space-y-2 pl-5 text-sm"
        >
          {Array.from(sources, ([id, source]) => [
            source.deducted > 0 && (
              <li key={`${id}-move`}>
                {t("assign.confirmMove", {
                  restored: formatHours(source.reversed),
                  deducted: formatHours(source.deducted),
                  from: source.name,
                  to: packageName,
                })}
              </li>
            ),
            source.invoiced > 0 && (
              <li key={`${id}-invoice`}>
                {t("assign.confirmInvoiceFrom", {
                  restored: formatHours(source.invoiceReversed),
                  hours: formatHours(source.invoiced),
                  from: source.name,
                })}
              </li>
            ),
          ])}
          {invoiceHours > 0 && (
            <li>
              {t("assign.confirmInvoice", { hours: formatHours(invoiceHours) })}
            </li>
          )}
          {unlinkedHours > 0 && (
            <li>
              {t("assign.confirmLink", {
                hours: formatHours(unlinkedHours),
                to: packageName,
              })}
            </li>
          )}
        </ul>
      ) : timeEntryIds ? (
        isLoading ? (
          <p role="status" className="text-sm">
            {tc("loading")}
          </p>
        ) : incompleteSelection ? (
          <p role="alert" className="text-sm">
            {t(isError ? "assign.loadFailed" : "assign.ineligibleSelection")}
          </p>
        ) : selectedEntries.length === 0 ? (
          <p role="status" className="text-sm">
            {t("assign.alreadyOnPackage")}
          </p>
        ) : null
      ) : (
        <fieldset
          disabled={assignMutation.isPending}
          className="min-w-0 space-y-3"
        >
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
            <input
              type="checkbox"
              className="accent-tt-gran"
              checked={filters.includeOtherCards}
              onChange={(event) =>
                updateFilters({ includeOtherCards: event.target.checked })
              }
            />
            {t("assign.includeOtherCards")}
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 block min-w-0 text-sm font-medium sm:col-span-1">
              {columns("project")}
              <select
                className="mt-1 block min-h-11 w-full rounded-lg border border-tt-kant bg-tt-flade px-3 text-base text-tt-blaek focus-visible:outline-2 focus-visible:outline-tt-fokus sm:min-h-8 sm:text-sm"
                value={filters.projectId}
                onChange={(event) =>
                  updateFilters({ projectId: event.target.value })
                }
              >
                <option value="">{tt("page.allProjects")}</option>
                {clientProjects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <Input
              id={`${filterId}-from`}
              type="date"
              className="min-h-11 min-w-0 text-base sm:min-h-8 sm:text-sm dark:scheme-dark"
              label={dates("from")}
              value={filters.from}
              onChange={(event) => updateFilters({ from: event.target.value })}
            />
            <Input
              id={`${filterId}-to`}
              type="date"
              className="min-h-11 min-w-0 text-base sm:min-h-8 sm:text-sm dark:scheme-dark"
              label={dates("to")}
              value={filters.to}
              error={invalidDates ? dates("dateOrder") : undefined}
              onChange={(event) => updateFilters({ to: event.target.value })}
            />
          </div>

          {projectError && (
            <p role="alert" className="text-sm">
              {t("assign.projectsFailed")}
            </p>
          )}
          {invalidDates ? null : isLoading ? (
            <div
              role="status"
              aria-label={tc("loading")}
              className="flex justify-center py-8"
            >
              <Loader2
                aria-hidden="true"
                className="h-6 w-6 animate-spin text-tt-gran"
              />
            </div>
          ) : isError ? (
            <p
              role="alert"
              className="rounded-lg border border-tt-streg px-3 py-4 text-sm"
            >
              {t("assign.loadFailed")}
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-tt-streg px-3 py-8 text-center text-sm text-tt-graa">
              {t("assign.empty")}
            </p>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(entries.map((entry) => entry.id)),
                  )
                }
              >
                {allSelected
                  ? t("assign.deselectAll")
                  : filteredProject && page === 0 && !limited
                    ? t("assign.selectProject", {
                        name: filteredProject.name,
                        count: entries.length,
                      })
                    : t("assign.selectAll", { count: entries.length })}
              </Button>
              <div className="max-h-72 overflow-auto rounded-lg border border-tt-streg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-tt-flade">
                    <tr>
                      <th scope="col" className="w-10">
                        <span className="sr-only">{t("assign.selection")}</span>
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2 py-2 font-medium sm:table-cell"
                      >
                        {columns("project")}
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2 py-2 font-medium sm:table-cell"
                      >
                        {columns("date")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {columns("description")}
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        {columns("hours")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tt-streg">
                    {entries.map((entry) => {
                      const date = new Date(entry.date).toLocaleDateString(
                        locale,
                        { timeZone: "UTC" },
                      );
                      const project =
                        entry.projectName ?? tt("group.noProject");
                      const description =
                        entry.description || tt("quick.noDescription");
                      return (
                        <tr key={entry.id}>
                          <td>
                            <label className="flex min-h-11 min-w-10 cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                className="accent-tt-gran"
                                aria-label={`${project}, ${date}, ${description}`}
                                checked={selected.has(entry.id)}
                                onChange={(event) =>
                                  toggle(entry.id, event.target.checked)
                                }
                              />
                            </label>
                          </td>
                          <td className="hidden px-2 py-2 sm:table-cell">
                            {project}
                          </td>
                          <td className="hidden whitespace-nowrap px-2 py-2 tabular-nums sm:table-cell">
                            {date}
                          </td>
                          <td className="px-2 py-2 [overflow-wrap:anywhere]">
                            <span className="flex flex-wrap gap-x-2 text-xs text-tt-graa sm:hidden">
                              <span>{project}</span>
                              <span className="tabular-nums">{date}</span>
                            </span>
                            {description}
                            {entry.prepaidPackageName && (
                              <span className="mt-1 block w-fit rounded-md bg-tt-flade px-2 py-1 text-xs">
                                {entry.prepaidPackageName}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {showBalanceHours(entry.hours)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {(page > 0 || limited) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
              >
                {tc("back")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!limited}
                onClick={() => changePage(page + 1)}
              >
                {tc("next")}
              </Button>
            </div>
          )}
        </fieldset>
      )}

      {exceedsBalance && !incompleteSelection && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        >
          {blocked &&
          minimumClipDeduction > 0 &&
          remainingHours < minimumClipDeduction
            ? t("assign.balanceBelowClip", {
                balance: showBalanceHours(remainingHours),
                minimum: showBalanceHours(minimumClipDeduction),
              })
            : blocked && largestPostingHours > 0
              ? t("assign.exceedsBlockWithClips", {
                  selected: showBalanceHours(deduction),
                  balance: showBalanceHours(remainingHours),
                  limit: showBalanceHours(largestPostingHours),
                })
              : t(
                  overdraftPolicy === "invoice"
                    ? "assign.exceedsInvoice"
                    : overdraftPolicy === "allow"
                      ? "assign.exceedsAllow"
                      : "assign.exceedsBlock",
                  {
                    selected: showBalanceHours(deduction),
                    balance: showBalanceHours(remainingHours),
                  },
                )}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-tt-streg pt-3">
        {!incompleteSelection && (
          <div aria-live="polite" className="space-y-1 text-sm tabular-nums">
            <p>
              {t("assign.selectedSummary", {
                count: selectedEntries.length,
                time: showDuration(selectedHours),
              })}
            </p>
            <p>
              {t("assign.balanceAfter", {
                time: showDuration(blocked ? remainingHours : balanceAfter),
              })}
            </p>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={assignMutation.isPending}
            onClick={reviewing ? () => setReviewing(false) : handleClose}
          >
            {tc(reviewing ? "back" : "cancel")}
          </Button>
          <Button
            type="button"
            isLoading={assignMutation.isPending}
            disabled={
              selectedEntries.length === 0 || blocked || incompleteSelection
            }
            onClick={submit}
          >
            {reviewing
              ? tc("confirm")
              : t(needsReview ? "assign.reviewMove" : "assign.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
