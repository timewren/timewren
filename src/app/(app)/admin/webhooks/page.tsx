"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Mail,
  Puzzle,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { trpc } from "@/providers/trpc-provider";

type Tab = "billing" | "email" | "resend" | "integrations";

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "billing", label: "Billing (Alunta/Stripe)", icon: Webhook },
  { key: "email", label: "Email leverancer", icon: Mail },
  { key: "resend", label: "Resend events", icon: Zap },
  { key: "integrations", label: "Integration sync", icon: Puzzle },
];

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { bg: string; fg: string; icon: React.ElementType }
  > = {
    success: { bg: "bg-green-100", fg: "text-green-800", icon: CheckCircle2 },
    delivered: { bg: "bg-green-100", fg: "text-green-800", icon: CheckCircle2 },
    sent: { bg: "bg-blue-100", fg: "text-blue-800", icon: CheckCircle2 },
    error: { bg: "bg-red-100", fg: "text-red-800", icon: XCircle },
    failed: { bg: "bg-red-100", fg: "text-red-800", icon: XCircle },
    bounced: { bg: "bg-amber-100", fg: "text-amber-800", icon: AlertCircle },
    needs_review: {
      bg: "bg-amber-100",
      fg: "text-amber-800",
      icon: AlertCircle,
    },
  };
  const s = map[status] ?? {
    bg: "bg-gray-100",
    fg: "text-gray-700",
    icon: AlertCircle,
  };
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.fg}`}
    >
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function BillingWebhooksTab() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    "success" | "error" | "needs_review" | ""
  >("");
  const limit = 30;

  const { data, isLoading } = trpc.admin.webhooks.listBillingWebhooks.useQuery({
    limit,
    offset: page * limit,
    status: statusFilter || undefined,
    daysBack: 30,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Total (30d)</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {data.total}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Success</p>
            <p className="mt-1 text-xl font-semibold text-green-600">
              {data.summary.success}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Fejl</p>
            <p className="mt-1 text-xl font-semibold text-red-600">
              {data.summary.error}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(
              e.target.value as "success" | "error" | "needs_review" | "",
            );
            setPage(0);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Alle statuser</option>
          <option value="success">Success</option>
          <option value="error">Fejl</option>
          <option value="needs_review">Kræver review</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tidspunkt
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Kilde
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Fejlbesked
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 5 }, (_, i) => `sk-${i}`).map((k) => (
                <tr key={k}>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))
            ) : data?.events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Ingen webhook events i den valgte periode
                </td>
              </tr>
            ) : (
              data?.events.map((e) => (
                <tr
                  key={e.id}
                  className={e.status === "error" ? "bg-red-50/30" : undefined}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                    {formatDateTime(e.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {e.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900">
                    {e.eventType}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="max-w-md truncate px-4 py-3 text-xs text-red-700">
                    {e.errorMessage ?? ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
            <span>
              Side {page + 1} af {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
              >
                <ChevronLeft className="h-3 w-3" />
                Forrige
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
              >
                Næste
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailDeliveriesTab() {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    "sent" | "delivered" | "bounced" | "failed" | ""
  >("");
  const [templateFilter, setTemplateFilter] = useState("");
  const limit = 30;

  const { data, isLoading } = trpc.admin.webhooks.listEmailDeliveries.useQuery({
    limit,
    offset: page * limit,
    status: statusFilter || undefined,
    templateType: templateFilter || undefined,
    daysBack: 14,
  });

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Sendt</p>
            <p className="mt-1 text-xl font-semibold text-brand-600">
              {data.statusSummary.sent}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Leveret</p>
            <p className="mt-1 text-xl font-semibold text-green-600">
              {data.statusSummary.delivered}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Bounced</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">
              {data.statusSummary.bounced}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Fejlet</p>
            <p className="mt-1 text-xl font-semibold text-red-600">
              {data.statusSummary.failed}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as never);
            setPage(0);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Alle statuser</option>
          <option value="sent">Sendt</option>
          <option value="delivered">Leveret</option>
          <option value="bounced">Bounced</option>
          <option value="failed">Fejlet</option>
        </select>
        <select
          value={templateFilter}
          onChange={(e) => {
            setTemplateFilter(e.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Alle skabeloner</option>
          {data?.templateSummary.map((t) => (
            <option key={t.templateType} value={t.templateType}>
              {t.templateType} ({t.count})
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Sendt
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Til
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Skabelon
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Emne
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 5 }, (_, i) => `sk-${i}`).map((k) => (
                <tr key={k}>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))
            ) : data?.events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Ingen email-leverancer
                </td>
              </tr>
            ) : (
              data?.events.map((e) => (
                <tr
                  key={e.id}
                  className={
                    e.status === "failed" || e.status === "bounced"
                      ? "bg-red-50/30"
                      : undefined
                  }
                >
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                    {formatDateTime(e.sentAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                    {e.to}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {e.templateType}
                    </span>
                  </td>
                  <td className="max-w-md truncate px-4 py-3 text-gray-700">
                    {e.subject}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResendEventsTab() {
  const { data, isLoading } = trpc.admin.webhooks.listResendEvents.useQuery({
    limit: 50,
    offset: 0,
    daysBack: 14,
  });

  return (
    <div className="space-y-4">
      {data?.eventTypeSummary && data.eventTypeSummary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          {data.eventTypeSummary.slice(0, 4).map((row) => (
            <div
              key={row.eventType}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <p className="text-xs text-gray-500">{row.eventType}</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {row.count}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tidspunkt
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Resend ID
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 5 }, (_, i) => `sk-${i}`).map((k) => (
                <tr key={k}>
                  <td colSpan={3} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </td>
                </tr>
              ))
            ) : data?.events.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                  Ingen Resend events
                </td>
              </tr>
            ) : (
              data?.events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                    {formatDateTime(e.occurredAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {e.eventType}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                    {e.resendEmailId}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntegrationSyncsTab() {
  const { data, isLoading } = trpc.admin.webhooks.listIntegrationSyncs.useQuery(
    { limit: 50, offset: 0, daysBack: 14 },
  );

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Tidspunkt
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Integration
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Operation
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Processed / Failed
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Fejl
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isLoading ? (
            Array.from({ length: 5 }, (_, i) => `sk-${i}`).map((k) => (
              <tr key={k}>
                <td colSpan={6} className="px-4 py-3">
                  <div className="h-4 animate-pulse rounded bg-gray-100" />
                </td>
              </tr>
            ))
          ) : data?.events.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                Ingen integration-syncs
              </td>
            </tr>
          ) : (
            data?.events.map((e) => (
              <tr
                key={e.id}
                className={
                  e.status === "error" || e.status === "failed"
                    ? "bg-red-50/30"
                    : undefined
                }
              >
                <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                  {formatDateTime(e.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {e.integrationType}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {e.operation}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                  {e.itemsProcessed ?? 0} / {e.itemsFailed ?? 0}
                </td>
                <td className="max-w-md truncate px-4 py-3 text-xs text-red-700">
                  {e.errorMessage ?? ""}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function WebhooksPage() {
  const [activeTab, setActiveTab] = useState<Tab>("billing");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Webhooks & leverancer
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Debug billing-webhooks, email-leverancer og
          integration-synkroniseringer
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "billing" && <BillingWebhooksTab />}
      {activeTab === "email" && <EmailDeliveriesTab />}
      {activeTab === "resend" && <ResendEventsTab />}
      {activeTab === "integrations" && <IntegrationSyncsTab />}
    </div>
  );
}
