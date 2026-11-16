"use client";

import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

type Step = "connect" | "preview" | "conflicts" | "import";

interface OrganizationInfo {
  name: string | null;
  vatNumber: string | null;
}

export default function TimeOpsImportPage() {
  const t = useTranslations("integrations.timeops");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const [step, setStep] = useState<Step>("connect");
  const [apiKey, setApiKey] = useState("");
  const [organization, setOrganization] = useState<OrganizationInfo | null>(
    null,
  );
  const [importId, setImportId] = useState<string | null>(null);

  const testConnection = trpc.imports.testConnection.useMutation({
    onSuccess: (data) => {
      setOrganization(data.organization);
      toast.success(
        t("connectedToast", { name: data.organization.name ?? "TimeOps" }),
      );
    },
    onError: (err) => {
      setOrganization(null);
      toast.error(err.message);
    },
  });

  const createPreview = trpc.imports.createPreview.useMutation({
    onSuccess: (data) => {
      setImportId(data.importId);
      setStep("preview");
    },
    onError: (err) => toast.error(err.message),
  });

  const startImport = trpc.imports.startImport.useMutation({
    onSuccess: () => setStep("import"),
    onError: (err) => {
      toast.error(t("importFailedToStart", { message: err.message }));
      // Stay on current step so user can retry
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("subtitle", { brand: brand.name })}
        </p>
      </div>

      {/* Progress indicator */}
      <StepIndicator currentStep={step} />

      {/* Step content */}
      {step === "connect" && (
        <ConnectStep
          apiKey={apiKey}
          setApiKey={setApiKey}
          organization={organization}
          onTest={() => testConnection.mutate({ apiKey })}
          testing={testConnection.isPending}
          onNext={() => createPreview.mutate({ apiKey })}
          preparingPreview={createPreview.isPending}
        />
      )}
      {step === "conflicts" && importId && (
        <ConflictsStep
          importId={importId}
          submitting={startImport.isPending}
          onNext={(resolutions) => {
            // Transition to "import" step happens in onSuccess — not here.
            // If the mutation fails, user stays on conflicts step and can retry.
            startImport.mutate({ importId, conflictResolutions: resolutions });
          }}
        />
      )}
      {step === "preview" && importId && (
        <PreviewStep
          importId={importId}
          onNext={() => setStep("conflicts")}
          onNextSkipConflicts={() => {
            // No conflicts → still need to call startImport with empty
            // resolutions so the cron job picks it up. Defaulting all
            // entities to "create_new" matches the non-conflict path.
            startImport.mutate({
              importId,
              conflictResolutions: { clients: {}, projects: {} },
            });
          }}
          submitting={startImport.isPending}
        />
      )}
      {step === "import" && importId && <ImportStep importId={importId} />}
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const t = useTranslations("integrations.timeops");
  const steps: { key: Step; label: string }[] = [
    { key: "connect", label: t("step.connect") },
    { key: "preview", label: t("step.preview") },
    { key: "conflicts", label: t("step.conflicts") },
    { key: "import", label: t("step.import") },
  ];
  const currentIdx = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, idx) => (
        <div key={s.key} className="flex flex-1 items-center gap-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              idx < currentIdx
                ? "bg-green-600 text-white"
                : idx === currentIdx
                  ? "bg-tt-gran text-tt-paa-gran"
                  : "bg-gray-200 text-gray-500 dark:bg-gray-700"
            }`}
          >
            {idx < currentIdx ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
          </div>
          <span
            className={`text-sm ${
              idx === currentIdx
                ? "font-semibold text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {s.label}
          </span>
          {idx < steps.length - 1 && (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
          )}
        </div>
      ))}
    </div>
  );
}

function ConnectStep({
  apiKey,
  setApiKey,
  organization,
  onTest,
  testing,
  onNext,
  preparingPreview,
}: {
  apiKey: string;
  setApiKey: (v: string) => void;
  organization: OrganizationInfo | null;
  onTest: () => void;
  testing: boolean;
  onNext: () => void;
  preparingPreview: boolean;
}) {
  const t = useTranslations("integrations.timeops");
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t("connectTitle")}
      </h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t("connectBody")}
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("apiKey")}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("apiKeyPlaceholder")}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </label>

        {organization && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
            <p className="font-medium">{t("connectedTo")}</p>
            <p>{organization.name ?? t("noName")}</p>
            {organization.vatNumber && (
              <p className="text-xs opacity-70">
                {t("vat", { number: organization.vatNumber })}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={!apiKey.trim() || testing}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {testing ? (
              <Loader2 className="inline h-4 w-4 animate-spin" />
            ) : (
              t("testConnection")
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!organization || preparingPreview}
            className="inline-flex items-center gap-1 rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {preparingPreview ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {t("next")}
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewStep({
  importId,
  onNext,
  onNextSkipConflicts,
  submitting,
}: {
  importId: string;
  onNext: () => void;
  onNextSkipConflicts: () => void;
  submitting?: boolean;
}) {
  const t = useTranslations("integrations.timeops");
  const { data, isLoading } = trpc.imports.getPreview.useQuery({ importId });

  if (isLoading || !data || !data.previewData) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("fetching")}
        </div>
      </div>
    );
  }

  const preview = data.previewData;
  const clientConflicts = preview.clients.filter((c) => c.conflict);
  const projectConflicts = preview.projects.filter((p) => p.conflict);
  const hasConflicts =
    clientConflicts.length > 0 || projectConflicts.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PreviewCard
          label={t("clients")}
          count={preview.clients.length}
          conflicts={clientConflicts.length}
        />
        <PreviewCard
          label={t("projects")}
          count={preview.projects.length}
          conflicts={projectConflicts.length}
        />
        <PreviewCard
          label={t("entries")}
          count={preview.entryCount}
          subtitle={
            preview.dateRange
              ? t("dateRange", {
                  from: preview.dateRange.from.slice(0, 10),
                  to: preview.dateRange.to.slice(0, 10),
                })
              : undefined
          }
        />
        <PreviewCard
          label={t("tags")}
          count={preview.tags.length}
          subtitle={t("mergedAuto")}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={hasConflicts ? onNext : onNextSkipConflicts}
          disabled={submitting}
          className="inline-flex items-center gap-1 rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {hasConflicts ? t("next") : t("startImport")}
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function PreviewCard({
  label,
  count,
  conflicts,
  subtitle,
}: {
  label: string;
  count: number;
  conflicts?: number;
  subtitle?: string;
}) {
  const t = useTranslations("integrations.timeops");
  const intlLocale = toIntlLocale(useLocale());
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
        {count.toLocaleString(intlLocale)}
      </p>
      {conflicts !== undefined && conflicts > 0 && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {t("conflicts", { count: conflicts })}
        </p>
      )}
      {subtitle && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

type Resolution = "skip" | "create_new" | "merge";

function ConflictsStep({
  importId,
  onNext,
  submitting,
}: {
  importId: string;
  onNext: (resolutions: {
    clients: Record<string, Resolution>;
    projects: Record<string, Resolution>;
  }) => void;
  submitting?: boolean;
}) {
  const t = useTranslations("integrations.timeops");
  const { data } = trpc.imports.getPreview.useQuery({ importId });
  const [clientResolutions, setClientResolutions] = useState<
    Record<string, Resolution>
  >({});
  const [projectResolutions, setProjectResolutions] = useState<
    Record<string, Resolution>
  >({});

  if (!data?.previewData) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const preview = data.previewData;
  const clientConflicts = preview.clients.filter((c) => c.conflict);
  const projectConflicts = preview.projects.filter((p) => p.conflict);

  const handleSubmit = () => {
    // Build full resolution map: conflicts get user choice, non-conflicts get "create_new"
    const clients: Record<string, Resolution> = {};
    for (const c of preview.clients) {
      clients[c.sourceId] = c.conflict
        ? (clientResolutions[c.sourceId] ?? "merge")
        : "create_new";
    }
    const projects: Record<string, Resolution> = {};
    for (const p of preview.projects) {
      projects[p.sourceId] = p.conflict
        ? (projectResolutions[p.sourceId] ?? "merge")
        : "create_new";
    }
    onNext({ clients, projects });
  };

  return (
    <div className="space-y-4">
      {clientConflicts.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("clientConflicts", { count: clientConflicts.length })}
          </h3>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
            {clientConflicts.map((c) => (
              <div
                key={c.sourceId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 dark:text-white">
                    <span className="font-medium">{c.name}</span>
                    {c.vatNumber && (
                      <span className="ml-1.5 text-xs text-gray-500">
                        ({t("vat", { number: c.vatNumber })})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t("matchesExisting", {
                      name: c.conflict?.existingName ?? "",
                    })}
                  </p>
                </div>
                <select
                  value={clientResolutions[c.sourceId] ?? "merge"}
                  onChange={(e) =>
                    setClientResolutions((prev) => ({
                      ...prev,
                      [c.sourceId]: e.target.value as Resolution,
                    }))
                  }
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="merge">{t("mergeSkip")}</option>
                  <option value="create_new">{t("createNew")}</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {projectConflicts.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("projectConflicts", { count: projectConflicts.length })}
          </h3>
          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
            {projectConflicts.map((p) => (
              <div
                key={p.sourceId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 dark:text-white">
                    <span className="font-medium">{p.name}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {t("matchesExisting", {
                      name: p.conflict?.existingName ?? "",
                    })}
                  </p>
                </div>
                <select
                  value={projectResolutions[p.sourceId] ?? "merge"}
                  onChange={(e) =>
                    setProjectResolutions((prev) => ({
                      ...prev,
                      [p.sourceId]: e.target.value as Resolution,
                    }))
                  }
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="merge">{t("mergeSkip")}</option>
                  <option value="create_new">{t("createNew")}</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-1 rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {t("continueToImport")}
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ImportStep({ importId }: { importId: string }) {
  const t = useTranslations("integrations.timeops");
  const intlLocale = toIntlLocale(useLocale());
  const { data } = trpc.imports.getStatus.useQuery(
    { importId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (
          status === "completed" ||
          status === "completed_with_errors" ||
          status === "failed" ||
          status === "cancelled"
        ) {
          return false;
        }
        return 2000;
      },
    },
  );

  const cancelImport = trpc.imports.cancelImport.useMutation({
    onSuccess: () => toast.success(t("cancelled")),
    onError: (err) => toast.error(err.message),
  });

  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const isFinished =
    data.status === "completed" ||
    data.status === "completed_with_errors" ||
    data.status === "failed" ||
    data.status === "cancelled";

  const progressPct =
    data.totalEntries > 0
      ? Math.round((data.processedEntries / data.totalEntries) * 100)
      : 0;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      {!isFinished && (
        <>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("running")}
          </h2>
          <div className="mt-4">
            {data.processedEntries === 0 && data.totalEntries > 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("preparing")}
              </p>
            ) : (
              <>
                <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full bg-brand-600 dark:bg-brand-400 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {t("progress", {
                    processed: data.processedEntries.toLocaleString(intlLocale),
                    total: data.totalEntries.toLocaleString(intlLocale),
                    pct: progressPct,
                  })}
                </p>
              </>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-400">{t("canClose")}</p>
            <button
              type="button"
              onClick={() => cancelImport.mutate({ importId })}
              disabled={cancelImport.isPending}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-400"
            >
              {cancelImport.isPending ? t("cancelling") : t("cancelImport")}
            </button>
          </div>
        </>
      )}

      {data.status === "completed" && (
        <ResultSummary status="completed" data={data} />
      )}

      {data.status === "completed_with_errors" && (
        <ResultSummary status="completed_with_errors" data={data} />
      )}

      {data.status === "cancelled" && (
        <div>
          <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400">
            {t("cancelled")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t("cancelledBody")}
            {data.processedEntries > 0 &&
              ` ${t("cancelledImported", { count: data.importedEntries })}`}
          </p>
          <div className="mt-4">
            <a
              href="/dashboard/time"
              className="inline-flex items-center gap-1 rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              {t("toTimeEntries")}
            </a>
          </div>
        </div>
      )}

      {data.status === "failed" && (
        <div>
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
            {t("failed")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t("failedBody")}
          </p>
          {Array.isArray(data.errors) && data.errors.length > 0 && (
            <pre className="mt-3 max-h-48 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {JSON.stringify(data.errors, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ResultSummary({
  status,
  data,
}: {
  status: "completed" | "completed_with_errors";
  data: {
    results: unknown;
    errors: unknown;
  };
}) {
  const results = data.results as {
    clients: { imported: number; skipped: number; merged: number };
    projects: { imported: number; skipped: number; merged: number };
    tags: { imported: number; skipped: number };
    entries: { imported: number; skipped: number; failed: number };
  } | null;
  const errors = (data.errors as Array<{ message: string }>) ?? [];
  const t = useTranslations("integrations.timeops");

  return (
    <div>
      <h2 className="text-lg font-semibold text-green-700 dark:text-green-400">
        {t("done")}
      </h2>
      {results && (
        <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <li>
            {t("resTags", {
              imported: results.tags.imported,
              skipped: results.tags.skipped,
            })}
          </li>
          <li>
            {t("resClients", {
              imported: results.clients.imported,
              merged: results.clients.merged,
            })}
          </li>
          <li>
            {t("resProjects", {
              imported: results.projects.imported,
              merged: results.projects.merged,
            })}
          </li>
          <li>
            {t("resEntries", {
              imported: results.entries.imported,
              skipped: results.entries.skipped,
              failed: results.entries.failed,
            })}
          </li>
        </ul>
      )}
      {status === "completed_with_errors" && errors.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-amber-700 dark:text-amber-400">
            {t("warnings", { count: errors.length })}
          </summary>
          <pre className="mt-2 max-h-48 overflow-y-auto rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {JSON.stringify(errors, null, 2)}
          </pre>
        </details>
      )}
      <div className="mt-4">
        <a
          href="/dashboard/time"
          className="inline-flex items-center gap-1 rounded-md bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          {t("toTimeEntries")}
        </a>
      </div>
    </div>
  );
}
