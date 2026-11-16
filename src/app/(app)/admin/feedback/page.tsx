"use client";

import {
  Bug,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Inbox,
  Lightbulb,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { shortReportId } from "@/lib/feedback/report-id";
import { trpc } from "@/providers/trpc-provider";

type FeedbackStatus = "new" | "seen" | "closed";
type FeedbackType = "feedback" | "feature" | "bug";

const TYPE_META: Record<
  FeedbackType,
  { label: string; icon: typeof Bug; className: string }
> = {
  feedback: {
    label: "Feedback",
    icon: MessageCircle,
    className: "bg-blue-50 text-blue-700",
  },
  feature: {
    label: "Idé",
    icon: Lightbulb,
    className: "bg-amber-50 text-amber-700",
  },
  bug: { label: "Fejl", icon: Bug, className: "bg-red-50 text-red-700" },
};

const STATUS_META: Record<
  FeedbackStatus,
  { label: string; className: string }
> = {
  new: { label: "Ny", className: "bg-purple-100 text-purple-700" },
  seen: { label: "Set", className: "bg-gray-100 text-gray-600" },
  closed: { label: "Lukket", className: "bg-green-100 text-green-700" },
};

function Screenshot({ id }: { id: string }) {
  const { data, isLoading, error } = trpc.feedback.getScreenshot.useQuery({
    id,
  });
  if (isLoading)
    return <p className="text-xs text-gray-400">Henter screenshot…</p>;
  if (error || !data)
    return <p className="text-xs text-red-500">Screenshot kunne ikke hentes</p>;
  return (
    <a href={data.dataUrl} target="_blank" rel="noreferrer">
      {/* biome-ignore lint/performance/noImgElement: data-url fra privat S3 — next/image kan ikke optimere den */}
      <img
        src={data.dataUrl}
        alt="Screenshot fra brugeren"
        className="mt-2 max-h-64 rounded-lg border border-gray-200"
      />
    </a>
  );
}

type StackFrame = { file: string; line: number; col: number; fn?: string };
type ConsoleEntry = {
  ts: string;
  level: string;
  message: string;
  stack?: StackFrame[];
};

function ConsoleEntryRow({ entry }: { entry: ConsoleEntry }) {
  const line = `[${entry.ts}] ${entry.level.toUpperCase()}: ${entry.message}`;
  if (!entry.stack || entry.stack.length === 0) {
    return <div className="whitespace-pre-wrap">{line}</div>;
  }
  return (
    <details>
      <summary className="cursor-pointer whitespace-pre-wrap">
        {line}
        <span className="ml-2 text-gray-400">
          ({entry.stack.length} frames)
        </span>
      </summary>
      <div className="mt-1 pl-4 text-gray-400">
        {entry.stack.map((f) => (
          <div key={`${f.file}:${f.line}:${f.col}`}>
            at {f.fn ?? "<anonym>"} ({f.file}:{f.line}:{f.col})
          </div>
        ))}
      </div>
    </details>
  );
}

type Rect = { x: number; y: number; width: number; height: number };
type ScreenshotRegion = {
  mode: "area" | "element";
  rect: Rect;
  viewport: Rect;
  annotated?: boolean;
  selector?: string;
};
type Breadcrumb = {
  ts: string;
  kind: "click" | "navigation" | "submit" | "visibility";
  target?: string;
  text?: string;
  from?: string;
  to?: string;
};
type ElementRef = { selector: string; tag: string; text: string };

const BREADCRUMB_LABELS: Record<Breadcrumb["kind"], string> = {
  click: "Klik",
  navigation: "Side",
  submit: "Formular",
  visibility: "Fane",
};

function timeOf(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleTimeString("da-DK", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function breadcrumbText(c: Breadcrumb) {
  if (c.kind === "navigation") return `${c.from ?? "?"} → ${c.to ?? "?"}`;
  if (c.kind === "visibility") return c.to === "hidden" ? "skjult" : "synlig";
  return [c.text ? `"${c.text}"` : null, c.target].filter(Boolean).join(" ");
}

/** Beskriver hvilken del af siden skærmbilledet viser. */
function regionText(region: ScreenshotRegion) {
  const { rect } = region;
  const what = region.mode === "area" ? "Område" : "Element";
  const size = `${rect.width}×${rect.height} px ved (${rect.x}, ${rect.y})`;
  const how = region.annotated
    ? "markeret på hele siden"
    : "klippet ud af siden";
  return `${what}, ${size}, ${how}${region.selector ? ` · ${region.selector}` : ""}`;
}

/**
 * Område-info står i context, så den vises også, når S3-upload fejlede og
 * billedet kun ligger i mailen.
 */
function ScreenshotRegionLine({
  context,
  hasScreenshot,
}: {
  context: Record<string, unknown> | null;
  hasScreenshot: boolean;
}) {
  const region = context?.screenshotRegion as ScreenshotRegion | undefined;
  if (!region && !hasScreenshot) return null;
  return (
    <p className="mt-3 text-xs text-gray-500">
      <strong>Skærmbillede:</strong>{" "}
      {region ? regionText(region) : "Hele siden"}
    </p>
  );
}

function ContextDetails({
  context,
}: {
  context: Record<string, unknown> | null;
}) {
  if (!context) return null;
  const consoleLog = context.console as ConsoleEntry[] | undefined;
  const timer = context.timer as
    | { isRunning: boolean; projectId: string | null; clientId: string | null }
    | undefined;
  const notes = context.notes as string[] | undefined;
  const breadcrumbs = context.breadcrumbs as Breadcrumb[] | undefined;
  const elements = context.elements as ElementRef[] | undefined;
  const browserFacts = [
    context.language ? `Sprog: ${String(context.language)}` : null,
    context.timezone ? `Tidszone: ${String(context.timezone)}` : null,
    context.screen ? `Skærm: ${String(context.screen)}` : null,
    context.colorScheme ? `Tema: ${String(context.colorScheme)}` : null,
    context.online === false ? "Offline" : null,
    context.connection ? `Forbindelse: ${String(context.connection)}` : null,
  ].filter(Boolean) as string[];
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
      <p>
        <strong>Side:</strong> {String(context.url ?? "-")} ·{" "}
        <strong>Viewport:</strong> {String(context.viewport ?? "-")} ·{" "}
        <strong>Version:</strong> {String(context.appVersion ?? "-")}
      </p>
      <p className="break-all">
        <strong>Browser:</strong> {String(context.userAgent ?? "-")}
      </p>
      {browserFacts.length > 0 && <p>{browserFacts.join(" · ")}</p>}
      {timer?.isRunning && (
        <p>
          <strong>Timer kørte</strong> (projekt: {timer.projectId ?? "-"},
          klient: {timer.clientId ?? "-"})
        </p>
      )}
      {notes && notes.length > 0 && (
        <p className="text-amber-700">
          <strong>Noter:</strong> {notes.join(" · ")}
        </p>
      )}
      {elements && elements.length > 0 && (
        <div>
          <strong>Elementer brugeren pegede på:</strong>
          <ul className="mt-1 space-y-0.5">
            {elements.map((e, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: samme element kan være peget på to gange
                key={`${e.selector}-${i}`}
                className="break-all"
              >
                <code className="font-mono text-[11px]">{e.selector}</code>
                {e.text ? ` "${e.text}"` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div>
          <strong>Før rapporten ({breadcrumbs.length}):</strong>
          <ol className="mt-1 max-h-48 space-y-0.5 overflow-auto">
            {breadcrumbs.map((c, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs har ingen id og vises i fast rækkefølge
                key={`${c.ts}-${i}`}
                className="flex gap-2"
              >
                <span className="shrink-0 tabular-nums text-gray-400">
                  {timeOf(c.ts)}
                </span>
                <span className="w-16 shrink-0 font-medium">
                  {BREADCRUMB_LABELS[c.kind] ?? c.kind}
                </span>
                <span className="break-all">{breadcrumbText(c)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {consoleLog && consoleLog.length > 0 && (
        <div className="max-h-48 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] leading-4 text-red-300">
          {consoleLog.map((c, i) => (
            <ConsoleEntryRow
              // biome-ignore lint/suspicious/noArrayIndexKey: console-linjer har ingen id og er ikke sorterbare
              key={`${c.ts}-${i}`}
              entry={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FeedbackAdminPage() {
  const [statusFilter, setStatusFilter] = useState<
    FeedbackStatus | undefined
  >();
  const [typeFilter, setTypeFilter] = useState<FeedbackType | undefined>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reportId, setReportId] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.feedback.adminList.useQuery({
    status: statusFilter,
    type: typeFilter,
    limit: 100,
    reportId: reportId.trim() || undefined,
  });

  const setStatusMutation = trpc.feedback.setStatus.useMutation({
    onSuccess: () => {
      utils.feedback.adminList.invalidate();
      toast.success("Status opdateret");
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Bruger-feedback
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Feedback, idéer og fejlrapporter indsendt via feedback-panelet
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">I alt (med filter)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {data?.total ?? "–"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Nye (ulæste)</p>
          <p className="mt-1 text-2xl font-semibold text-purple-600">
            {data?.newCount ?? "–"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Viste</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {rows.length}
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="feedback-report-id"
          className="block text-sm font-medium text-gray-700"
        >
          Rapportnummer
        </label>
        <input
          id="feedback-report-id"
          type="search"
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          placeholder="Fx 731cf28b"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter(undefined)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${!statusFilter ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
        >
          Alle statusser
        </button>
        {(Object.keys(STATUS_META) as FeedbackStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(statusFilter === s ? undefined : s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {STATUS_META[s].label}
          </button>
        ))}
        <span className="mx-1 border-l border-gray-200" />
        {(Object.keys(TYPE_META) as FeedbackType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(typeFilter === t ? undefined : t)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${typeFilter === t ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {TYPE_META[t].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Indlæser feedback…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">
            Ingen feedback matcher filteret.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const typeMeta = TYPE_META[row.type as FeedbackType];
            const statusMeta = STATUS_META[row.status as FeedbackStatus];
            const TypeIcon = typeMeta?.icon ?? MessageCircle;
            const isExpanded = expanded === row.id;
            return (
              <div
                key={row.id}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${typeMeta?.className ?? ""}`}
                  >
                    <TypeIcon className="h-3 w-3" />
                    {typeMeta?.label ?? row.type}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta?.className ?? ""}`}
                  >
                    {statusMeta?.label ?? row.status}
                  </span>
                  {row.screenshotKey && (
                    <Camera className="h-3.5 w-3.5 text-gray-400" />
                  )}
                  <code
                    className="ml-auto font-mono text-xs text-gray-400"
                    title={`Rapport-id ${row.id}`}
                  >
                    {shortReportId(row.id)}
                  </code>
                  <span className="text-xs text-gray-400">
                    {new Date(row.createdAt).toLocaleString("da-DK")}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                  {row.message}
                </p>

                <p className="mt-2 text-xs text-gray-500">
                  {row.userName ?? "Uden konto (app)"} (
                  {row.userEmail ?? row.contactEmail ?? "ingen mail"})
                  {row.orgName ? ` · ${row.orgName}` : ""}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {row.status !== "seen" && (
                    <button
                      type="button"
                      onClick={() =>
                        setStatusMutation.mutate({ id: row.id, status: "seen" })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Eye className="h-3.5 w-3.5" /> Markér som set
                    </button>
                  )}
                  {row.status !== "closed" && (
                    <button
                      type="button"
                      onClick={() =>
                        setStatusMutation.mutate({
                          id: row.id,
                          status: "closed",
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-green-700 hover:bg-green-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Luk
                    </button>
                  )}
                  {row.status === "closed" && (
                    <button
                      type="button"
                      onClick={() =>
                        setStatusMutation.mutate({ id: row.id, status: "new" })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Genåbn
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : row.id)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" /> Skjul detaljer
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" /> Detaljer
                      </>
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <>
                    <p className="mt-3 text-xs text-gray-500">
                      <strong>Rapport-id:</strong>{" "}
                      <code className="font-mono select-all">{row.id}</code>
                    </p>
                    <ContextDetails
                      context={row.context as Record<string, unknown> | null}
                    />
                    <ScreenshotRegionLine
                      context={row.context as Record<string, unknown> | null}
                      hasScreenshot={!!row.screenshotKey}
                    />
                    {row.screenshotKey && <Screenshot id={row.id} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
