"use client";

import {
  CalendarClock,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  ConfirmDialog,
  Input,
  ModalWithFooter,
  Select,
  Textarea,
} from "@/components/ui";
import { useModules } from "@/hooks/useModules";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency } from "@/lib/format";
import {
  anchorDayOf,
  fixedLinesTotal,
  isRecurringInvoiceInterval,
  PERIOD_VARIABLES,
  RECURRING_INVOICE_INTERVAL_LABELS,
  type RecurringInvoiceInterval,
  type RecurringInvoiceLineInput,
  type RecurringInvoiceMode,
  upcomingRunDates,
} from "@/lib/recurring-invoices/schedule";
import {
  addMonthsToDateStr,
  copenhagenToday,
  monthStartDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type TemplateRow = RouterOutputs["recurringInvoices"]["list"][number];

interface FormState {
  name: string;
  clientId: string;
  billingMode: RecurringInvoiceMode;
  projectId: string;
  prepaidPackageId: string;
  interval: RecurringInvoiceInterval;
  nextRunDate: string;
  lines: RecurringInvoiceLineInput[];
  invoiceTemplateId: string;
  paymentTermsDays: string;
  notes: string;
}

const EMPTY_LINE: RecurringInvoiceLineInput = {
  description: "",
  quantity: "1",
  unitPrice: "",
};

function emptyForm(clientId: string): FormState {
  return {
    name: "",
    clientId,
    billingMode: "fixed",
    projectId: "",
    prepaidPackageId: "",
    interval: "monthly",
    // Standard: den 1. i næste måned
    nextRunDate: addMonthsToDateStr(monthStartDateStr(copenhagenToday()), 1),
    lines: [{ ...EMPTY_LINE }],
    invoiceTemplateId: "",
    paymentTermsDays: "",
    notes: "",
  };
}

function formFromRow(row: TemplateRow): FormState {
  return {
    name: row.name,
    clientId: row.clientId,
    billingMode: row.billingMode === "time" ? "time" : "fixed",
    projectId: row.projectId ?? "",
    prepaidPackageId: row.prepaidPackageId ?? "",
    interval: isRecurringInvoiceInterval(row.interval)
      ? row.interval
      : "monthly",
    nextRunDate: row.nextRunDate,
    lines: row.lines.length > 0 ? row.lines : [],
    invoiceTemplateId: row.invoiceTemplateId ?? "",
    paymentTermsDays:
      row.paymentTermsDays == null ? "" : String(row.paymentTermsDays),
    notes: row.notes ?? "",
  };
}

/** "2026-11-01" → "1. nov. 2026" */
function formatDayInLocale(dateStr: string, locale: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(
    toIntlLocale(locale),
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

function rowAmountLabel(
  row: TemplateRow,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const fixed = fixedLinesTotal(row.lines);
  if (row.billingMode === "time") {
    return fixed > 0
      ? t("recurring.amountTimePlus", { amount: formatCurrency(fixed) })
      : t("recurring.amountTime");
  }
  if (fixed > 0) return formatCurrency(fixed);
  if (row.prepaidPackage) {
    const hours = Number.parseFloat(
      row.prepaidPackage.renewalBaseHours ||
        row.prepaidPackage.totalHours ||
        "0",
    );
    const rate = Number.parseFloat(row.prepaidPackage.hourlyRate || "0");
    return formatCurrency(hours * rate);
  }
  return formatCurrency(0);
}

/**
 * Gentagne fakturaer / retainere (#198): opret, redigér, sæt på pause og slet
 * skabeloner, og se de kommende kladder. Bruges på fakturasiden (alle kunder)
 * og på kundens fakturerings-fane (`clientId`).
 */
export function RecurringInvoicesPanel({ clientId }: { clientId?: string }) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const formatDay = (dateStr: string) => formatDayInLocale(dateStr, locale);
  const { isEnabled } = useModules();
  const { canWrite } = usePermission("invoices");
  const enabled = isEnabled("invoicing");
  const canEdit = enabled && canWrite;
  const utils = trpc.useUtils();

  const { data: rows, isLoading } = trpc.recurringInvoices.list.useQuery(
    clientId ? { clientId } : undefined,
    { enabled },
  );

  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);

  const invalidate = () => utils.recurringInvoices.list.invalidate();

  const pauseMutation = trpc.recurringInvoices.setPaused.useMutation({
    onSuccess: (_row, vars) => {
      invalidate();
      toast.success(
        vars.paused ? t("recurring.paused") : t("recurring.resumed"),
      );
    },
    onError: (err) => toast.error(err.message || t("recurring.updateFailed")),
  });
  const deleteMutation = trpc.recurringInvoices.delete.useMutation({
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success(t("recurring.deleted"));
    },
    onError: (err) => toast.error(err.message || t("recurring.deleteFailed")),
  });

  if (!enabled) return null;

  return (
    <section
      aria-labelledby="recurring-invoices-heading"
      className="rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-col gap-3 border-b border-gray-200/80 px-4 py-3 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            id="recurring-invoices-heading"
            className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"
          >
            <Repeat className="h-4 w-4 text-gray-500" aria-hidden="true" />
            {t("recurring.title")}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("recurring.subtitle")}
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setEditing("new")}
          >
            {t("recurring.newRecurring")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4" aria-busy="true">
          <div className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          <div className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
          {t("recurring.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row) => {
            const interval = isRecurringInvoiceInterval(row.interval)
              ? row.interval
              : null;
            const upcoming =
              interval && !row.prepaidPackageId && !row.isPaused
                ? upcomingRunDates(row.nextRunDate, interval, row.anchorDay, 3)
                : [];
            return (
              <li
                key={row.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {row.name}
                    </span>
                    {row.isPaused ? (
                      <Badge size="sm" variant="warning">
                        {t("recurring.badgePaused")}
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="success">
                        {t("recurring.badgeActive")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {!clientId && row.client ? `${row.client.name} · ` : ""}
                    {rowAmountLabel(row, t)}
                    <span className="text-gray-400">
                      {t("recurring.excludingVat")}
                    </span>
                    {" · "}
                    {interval
                      ? t(`recurring.interval.${interval}`)
                      : row.interval}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <CalendarClock
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {row.prepaidPackageId
                      ? t("recurring.followsPackage", {
                          name: row.prepaidPackage?.name ?? "",
                          date: row.prepaidPackage?.renewalNextAt
                            ? formatDay(
                                toCopenhagenDateStr(
                                  new Date(row.prepaidPackage.renewalNextAt),
                                ),
                              )
                            : formatDay(row.nextRunDate),
                        })
                      : row.isPaused
                        ? t("recurring.noDraftsWhilePaused")
                        : t("recurring.upcomingDrafts", {
                            dates: upcoming.map(formatDay).join(", "),
                          })}
                  </p>
                  {row.lastRun && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t("recurring.lastCreated", {
                        start: formatDay(row.lastRun.periodStart),
                        end: formatDay(row.lastRun.periodEnd),
                      })}
                      {row.lastRun.invoiceId ? (
                        <>
                          {" · "}
                          <a
                            href={`/dashboard/invoices/${row.lastRun.invoiceId}`}
                            className="text-brand-600 hover:underline dark:text-brand-400"
                          >
                            {t("recurring.openDraft")}
                          </a>
                        </>
                      ) : null}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Pencil className="h-4 w-4" />}
                      onClick={() => setEditing(row)}
                    >
                      {t("recurring.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={
                        pauseMutation.isPending &&
                        pauseMutation.variables?.id === row.id
                      }
                      leftIcon={
                        row.isPaused ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )
                      }
                      onClick={() =>
                        pauseMutation.mutate({
                          id: row.id,
                          paused: !row.isPaused,
                        })
                      }
                    >
                      {row.isPaused
                        ? t("recurring.resume")
                        : t("recurring.pause")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("recurring.deleteAria", { name: row.name })}
                      onClick={() => setDeleting(row)}
                    >
                      <Trash2 className="h-4 w-4 text-danger-600" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <RecurringInvoiceFormModal
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          fixedClientId={clientId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate({ id: deleting.id })}
        title={t("recurring.deleteTitle")}
        description={t("recurring.deleteDescription", {
          name: deleting?.name ?? "",
        })}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </section>
  );
}

function RecurringInvoiceFormModal({
  row,
  fixedClientId,
  onClose,
  onSaved,
}: {
  row: TemplateRow | null;
  fixedClientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const formatDay = (dateStr: string) => formatDayInLocale(dateStr, locale);
  const [form, setForm] = useState<FormState>(() =>
    row ? formFromRow(row) : emptyForm(fixedClientId ?? ""),
  );
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const { data: clientList } = trpc.clients.list.useQuery(undefined, {
    enabled: !fixedClientId,
  });
  const { data: projectList } = trpc.projects.getByClient.useQuery(
    { clientId: form.clientId },
    { enabled: !!form.clientId && form.billingMode === "time" },
  );
  const { data: packageList } = trpc.prepaid.list.useQuery(
    { clientId: form.clientId, activeOnly: true },
    { enabled: !!form.clientId && form.billingMode === "fixed" },
  );
  const { data: templateList } = trpc.invoiceTemplates.list.useQuery();

  const periodicPackages = useMemo(
    () =>
      (packageList ?? []).filter(
        (p) =>
          p.renewalInterval &&
          p.renewalNextAt &&
          (!p.isArchived || p.id === form.prepaidPackageId),
      ),
    [packageList, form.prepaidPackageId],
  );
  const linkedPackage = periodicPackages.find(
    (p) => p.id === form.prepaidPackageId,
  );

  const createMutation = trpc.recurringInvoices.create.useMutation({
    onSuccess: () => {
      toast.success(t("recurring.createdToast"));
      onSaved();
    },
    onError: (err) => toast.error(err.message || t("recurring.createFailed")),
  });
  const updateMutation = trpc.recurringInvoices.update.useMutation({
    onSuccess: () => {
      toast.success(t("recurring.savedToast"));
      onSaved();
    },
    onError: (err) => toast.error(err.message || t("recurring.saveFailed")),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const total = fixedLinesTotal(form.lines);
  const upcoming =
    !linkedPackage && form.nextRunDate
      ? upcomingRunDates(
          form.nextRunDate,
          form.interval,
          anchorDayOf(form.nextRunDate),
          3,
        )
      : [];

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast.error(t("recurring.nameRequired"));
      return;
    }
    if (!form.clientId) {
      toast.error(t("recurring.clientRequired"));
      return;
    }
    const lines = form.lines.filter(
      (l) => l.description.trim() !== "" || l.unitPrice.trim() !== "",
    );
    const payload = {
      name: form.name.trim(),
      clientId: form.clientId,
      billingMode: form.billingMode,
      projectId:
        form.billingMode === "time" && form.projectId ? form.projectId : null,
      prepaidPackageId:
        form.billingMode === "fixed" && form.prepaidPackageId
          ? form.prepaidPackageId
          : null,
      interval: form.interval,
      nextRunDate: form.nextRunDate,
      lines: lines.map((l) => ({
        description: l.description.trim(),
        quantity: l.quantity.trim().replace(",", ".") || "1",
        unitPrice: l.unitPrice.trim().replace(",", ".") || "0",
      })),
      invoiceTemplateId: form.invoiceTemplateId || null,
      paymentTermsDays:
        form.paymentTermsDays.trim() === ""
          ? null
          : Number.parseInt(form.paymentTermsDays, 10),
      notes: form.notes.trim() || null,
    };
    if (row) updateMutation.mutate({ id: row.id, ...payload });
    else createMutation.mutate(payload);
  };

  const updateLine = (
    index: number,
    patch: Partial<RecurringInvoiceLineInput>,
  ) =>
    set(
      "lines",
      form.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );

  return (
    <ModalWithFooter
      isOpen
      onClose={onClose}
      size="xl"
      title={row ? t("recurring.modalEditTitle") : t("recurring.newRecurring")}
      description={t("recurring.modalDescription")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {t("recurring.cancel")}
          </Button>
          <Button onClick={handleSubmit} isLoading={isSaving}>
            {row ? t("recurring.save") : t("recurring.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("recurring.name")}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={t("recurring.namePlaceholder")}
          maxLength={255}
          fullWidth
        />

        {!fixedClientId && (
          <Select
            label={t("recurring.client")}
            value={form.clientId}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                clientId: e.target.value,
                projectId: "",
                prepaidPackageId: "",
              }))
            }
            placeholder={t("recurring.selectClient")}
            options={(clientList ?? []).map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            fullWidth
          />
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("recurring.whatBilled")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: "fixed",
                  label: t("recurring.modeFixed"),
                  hint: t("recurring.modeFixedHint"),
                },
                {
                  value: "time",
                  label: t("recurring.modeTime"),
                  hint: t("recurring.modeTimeHint"),
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm ${
                  form.billingMode === opt.value
                    ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-tt-gran-lys"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="billingMode"
                  value={opt.value}
                  checked={form.billingMode === opt.value}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      billingMode: opt.value,
                      prepaidPackageId: "",
                      projectId: "",
                    }))
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-gray-900 dark:text-white">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {opt.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {form.billingMode === "time" && form.clientId && (
          <Select
            label={t("recurring.projectOptional")}
            value={form.projectId}
            onChange={(e) => set("projectId", e.target.value)}
            options={[
              { value: "", label: t("recurring.allClientTime") },
              ...(projectList ?? []).map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
            fullWidth
          />
        )}

        {form.billingMode === "fixed" && periodicPackages.length > 0 && (
          <Select
            label={t("recurring.linkPackage")}
            hint={t("recurring.linkPackageHint")}
            value={form.prepaidPackageId}
            onChange={(e) => set("prepaidPackageId", e.target.value)}
            options={[
              { value: "", label: t("recurring.ownCalendar") },
              ...periodicPackages.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
            fullWidth
          />
        )}

        {!linkedPackage && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("recurring.intervalLabel")}
              value={form.interval}
              onChange={(e) =>
                set("interval", e.target.value as RecurringInvoiceInterval)
              }
              options={Object.keys(RECURRING_INVOICE_INTERVAL_LABELS).map(
                (value) => ({ value, label: t(`recurring.interval.${value}`) }),
              )}
              fullWidth
            />
            <Input
              type="date"
              label={row ? t("recurring.nextDraft") : t("recurring.firstDraft")}
              value={form.nextRunDate}
              min={copenhagenToday()}
              onChange={(e) => set("nextRunDate", e.target.value)}
              fullWidth
            />
          </div>
        )}
        {upcoming.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("recurring.upcomingDrafts", {
              dates: upcoming.map(formatDay).join(", "),
            })}
            {anchorDayOf(form.nextRunDate) > 28 && t("recurring.shortMonths")}
          </p>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {form.billingMode === "time"
                ? t("recurring.linesFixedOptional")
                : linkedPackage
                  ? t("recurring.linesPackage")
                  : t("recurring.lines")}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {total > 0 &&
                t("recurring.totalExVat", { amount: formatCurrency(total) })}
            </span>
          </div>
          <div className="space-y-2">
            {form.lines.map((line, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: linjerne har ingen id; rækkefølgen er identiteten
                key={i}
                className="grid grid-cols-[1fr_4.5rem_6.5rem_2.25rem] items-start gap-2"
              >
                <Input
                  aria-label={t("recurring.lineDescriptionAria", { n: i + 1 })}
                  value={line.description}
                  onChange={(e) =>
                    updateLine(i, { description: e.target.value })
                  }
                  placeholder={t("recurring.lineDescriptionPlaceholder")}
                  fullWidth
                />
                <Input
                  aria-label={t("recurring.lineQuantityAria", { n: i + 1 })}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  fullWidth
                />
                <Input
                  aria-label={t("recurring.lineUnitPriceAria", { n: i + 1 })}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  placeholder={t("recurring.pricePlaceholder")}
                  fullWidth
                />
                <button
                  type="button"
                  aria-label={t("recurring.removeLine", { n: i + 1 })}
                  onClick={() =>
                    set(
                      "lines",
                      form.lines.filter((_, j) => j !== i),
                    )
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => set("lines", [...form.lines, { ...EMPTY_LINE }])}
            >
              {t("recurring.addLine")}
            </Button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("recurring.variables", { list: PERIOD_VARIABLES.join(" ") })}
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t("recurring.templateLabel")}
            value={form.invoiceTemplateId}
            onChange={(e) => set("invoiceTemplateId", e.target.value)}
            options={[
              { value: "", label: t("recurring.defaultTemplate") },
              ...(templateList ?? []).map((tpl) => ({
                value: tpl.id,
                label: t("recurring.templateOption", {
                  name: tpl.name,
                  rate: Number.parseFloat(tpl.vatRate ?? "25"),
                }),
              })),
            ]}
            fullWidth
          />
          <Input
            type="number"
            label={t("recurring.paymentDays")}
            hint={t("recurring.paymentDaysHint")}
            min={0}
            max={365}
            value={form.paymentTermsDays}
            onChange={(e) => set("paymentTermsDays", e.target.value)}
            fullWidth
          />
        </div>

        <Textarea
          label={t("recurring.noteLabel")}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder={t("recurring.notePlaceholder")}
        />
      </div>
    </ModalWithFooter>
  );
}
