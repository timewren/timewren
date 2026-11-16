"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SlaBadge({
  status,
  daysLeft,
}: {
  status: "ok" | "approaching" | "breached";
  daysLeft: number;
}) {
  if (status === "breached") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertTriangle className="h-3 w-3" />
        SLA overskredet
      </span>
    );
  }
  if (status === "approaching") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Clock className="h-3 w-3" />
        {daysLeft}d tilbage
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      <CheckCircle2 className="h-3 w-3" />
      OK
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    pending: { bg: "bg-yellow-100", fg: "text-yellow-800" },
    processing: { bg: "bg-blue-100", fg: "text-blue-800" },
    ready: { bg: "bg-green-100", fg: "text-green-800" },
    downloaded: { bg: "bg-gray-100", fg: "text-gray-700" },
    expired: { bg: "bg-gray-100", fg: "text-gray-500" },
    failed: { bg: "bg-red-100", fg: "text-red-800" },
  };
  const s = map[status] ?? { bg: "bg-gray-100", fg: "text-gray-600" };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.fg}`}
    >
      {status}
    </span>
  );
}

export function GdprView() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showOnlyRisk, setShowOnlyRisk] = useState(false);

  const { data, isLoading } = trpc.admin.gdpr.listRequests.useQuery({
    limit: 50,
    offset: 0,
    status: statusFilter ? (statusFilter as never) : undefined,
    slaRisk: showOnlyRisk || undefined,
  });

  const markHandled = trpc.admin.gdpr.markHandled.useMutation({
    onSuccess: () => {
      toast.success("Markeret som håndteret");
      utils.admin.gdpr.listRequests.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* SLA alerts */}
      {data && (data.slaBreached > 0 || data.slaRisk > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.slaBreached > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-sm font-semibold text-red-900">
                    {data.slaBreached} anmodning(er) over 30 dage
                  </p>
                  <p className="mt-0.5 text-xs text-red-700">
                    GDPR-SLA er brudt — handl straks
                  </p>
                </div>
              </div>
            </div>
          )}
          {data.slaRisk > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {data.slaRisk} anmodning(er) over 25 dage
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Nærmer sig GDPR-deadline
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Alle statuser</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="ready">Ready</option>
          <option value="downloaded">Downloaded</option>
          <option value="expired">Expired</option>
          <option value="failed">Failed</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showOnlyRisk}
            onChange={(e) => setShowOnlyRisk(e.target.checked)}
            className="rounded"
          />
          Kun SLA-risiko
        </label>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Anmodet
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Bruger
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                SLA
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Handlinger
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
            ) : data?.requests.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-400" />
                  <p className="text-sm text-gray-500">
                    Ingen GDPR-anmodninger
                  </p>
                </td>
              </tr>
            ) : (
              data?.requests.map((r) => {
                const daysLeft = 30 - r.ageDays;
                return (
                  <tr
                    key={r.id}
                    className={
                      r.slaStatus === "breached" ? "bg-red-50/30" : undefined
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <div>{formatDate(r.createdAt)}</div>
                      <div className="text-xs text-gray-500">
                        {r.ageDays}d siden
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-brand-600 hover:underline"
                      >
                        {r.userName || r.userEmail || r.userId.slice(0, 8)}
                      </Link>
                      {r.userEmail && (
                        <div className="text-xs text-gray-500">
                          {r.userEmail}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {r.requestType}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <SlaBadge
                        status={r.slaStatus}
                        daysLeft={Math.max(0, daysLeft)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.status === "ready" && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <Download className="h-3.5 w-3.5" />
                            {r.fileSizeBytes
                              ? `${Math.round((r.fileSizeBytes / 1024 / 1024) * 10) / 10} MB`
                              : "klar"}
                          </span>
                        )}
                        {r.status === "pending" && (
                          <button
                            type="button"
                            onClick={() =>
                              markHandled.mutate({
                                id: r.id,
                                note: "Manuelt håndteret af admin",
                              })
                            }
                            disabled={markHandled.isPending}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Markér håndteret
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4 text-sm text-brand-900">
        <p className="font-medium">GDPR Art. 12</p>
        <p className="mt-1 text-xs">
          Anmodninger om data-eksport eller sletning skal besvares inden 30 dage
          efter modtagelse. Dette dashboard sporer SLA og markerer risiko- og
          overskredne requests i rødt.
        </p>
      </div>
    </div>
  );
}
