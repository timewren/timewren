"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModalWithFooter } from "@/components/ui";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import { trpc } from "@/providers/trpc-provider";
import {
  PortalEmpty,
  PortalLoading,
  PortalQueryError,
  PortalShell,
  portalTable,
  usePortalFormat,
} from "../_components/PortalShell";

export default function PortalApprovalsPage() {
  const router = useRouter();
  const { isCustomDomain } = useCustomDomain();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("portalSession");
    if (token) {
      setSessionToken(token);
    } else {
      router.push(getPortalPath("/portal/login", isCustomDomain));
    }
    setBootstrapping(false);
  }, [router, isCustomDomain]);

  if (bootstrapping || !sessionToken) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PortalLoading />
      </div>
    );
  }

  return <ApprovalsView sessionToken={sessionToken} />;
}

function ApprovalsView({ sessionToken }: { sessionToken: string }) {
  const t = useTranslations("portal.approvals");
  const f = usePortalFormat();
  const router = useRouter();
  const { isCustomDomain } = useCustomDomain();
  const utils = trpc.useUtils();

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = trpc.publicPortal.validateSession.useQuery(
    { sessionToken },
    { retry: false },
  );

  useEffect(() => {
    if (sessionError || (session && !session.valid)) {
      localStorage.removeItem("portalSession");
      router.push(getPortalPath("/portal/login", isCustomDomain));
    }
  }, [sessionError, session, router, isCustomDomain]);

  const {
    data: requests,
    isLoading,
    isError,
    refetch,
  } = trpc.publicPortal.getMyApprovalRequests.useQuery(
    { sessionToken },
    { enabled: !!session?.valid },
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  const approve = trpc.publicPortal.approveRequest.useMutation({
    onSuccess: () => {
      toast.success(t("approved"));
      utils.publicPortal.getMyApprovalRequests.invalidate();
      setSelectedId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = trpc.publicPortal.rejectRequest.useMutation({
    onSuccess: () => {
      toast.success(t("rejected"));
      utils.publicPortal.getMyApprovalRequests.invalidate();
      setSelectedId(null);
      setShowRejectModal(false);
      setRejectReason("");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedRequest = requests?.find((r) => r.id === selectedId);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PortalLoading label={t("validating")} />
      </div>
    );
  }

  if (!session?.valid || !session.access) {
    return null;
  }

  const { access, branding } = session;
  const canApprove = access.permissions.canApproveTime ?? false;

  const requestTitle = (r: {
    type: string;
    periodStart?: string | null;
    periodEnd?: string | null;
  }) =>
    r.type === "period"
      ? t("periodTitle", {
          start: f.date(r.periodStart),
          end: f.date(r.periodEnd),
        })
      : t("invoiceDraft");

  return (
    <PortalShell
      sessionToken={sessionToken}
      clientName={access.clientName}
      branding={branding}
      permissions={access.permissions}
      active="approvals"
      width="narrow"
    >
      {!canApprove ? (
        <PortalEmpty
          icon={Check}
          title={t("noAccessTitle")}
          text={t("noAccessText")}
        />
      ) : isLoading ? (
        <PortalLoading />
      ) : isError ? (
        <PortalQueryError onRetry={() => void refetch()} />
      ) : !requests || requests.length === 0 ? (
        <div className="space-y-4">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <PortalEmpty
            icon={Check}
            title={t("emptyTitle")}
            text={t("emptyText")}
          />
        </div>
      ) : selectedRequest ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("backToAll")}
          </button>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
                {requestTitle(selectedRequest)}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {t.rich("requestSummary", {
                  count: selectedRequest.entries.length,
                  hours: f.hours(
                    selectedRequest.entries.reduce(
                      (s, e) => s + Number(e.hours),
                      0,
                    ),
                  ),
                  num: (chunks) => (
                    <span className="tabular-nums">{chunks}</span>
                  ),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                disabled={reject.isPending || approve.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <X className="h-3.5 w-3.5" />
                {t("reject")}
              </button>
              <button
                type="button"
                onClick={() =>
                  approve.mutate({
                    sessionToken,
                    requestId: selectedRequest.id,
                  })
                }
                disabled={approve.isPending || reject.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {approve.isPending ? t("approving") : t("approveAll")}
              </button>
            </div>
          </div>

          <div className={portalTable.wrap}>
            <table className={portalTable.table}>
              <thead>
                <tr className={portalTable.headRow}>
                  <th className={portalTable.th}>{t("colDate")}</th>
                  <th className={`${portalTable.th} hidden sm:table-cell`}>
                    {t("colProject")}
                  </th>
                  <th className={portalTable.th}>{t("colDescription")}</th>
                  <th className={portalTable.thRight}>{t("colHours")}</th>
                </tr>
              </thead>
              <tbody>
                {selectedRequest.entries.map((entry) => (
                  <tr key={entry.id} className={portalTable.row}>
                    <td className={`${portalTable.td} whitespace-nowrap`}>
                      {f.date(entry.date)}
                    </td>
                    <td
                      className={`${portalTable.tdMuted} hidden sm:table-cell`}
                    >
                      {entry.projectName ?? "–"}
                    </td>
                    <td className={`${portalTable.tdMuted} max-w-xs`}>
                      <span className="line-clamp-1">
                        {entry.description || "–"}
                      </span>
                    </td>
                    <td className={portalTable.tdNum}>
                      {f.hours(entry.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ModalWithFooter
            isOpen={showRejectModal}
            onClose={() => {
              setShowRejectModal(false);
              setRejectReason("");
            }}
            title={t("rejectTitle")}
            description={t("rejectDescription")}
            size="md"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason("");
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    reject.mutate({
                      sessionToken,
                      requestId: selectedRequest.id,
                      reason: rejectReason,
                    })
                  }
                  disabled={!rejectReason.trim() || reject.isPending}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {reject.isPending ? t("rejecting") : t("reject")}
                </button>
              </>
            }
          >
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("rejectPlaceholder")}
              rows={4}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </ModalWithFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t("title")}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t("pendingCount", { count: requests.length })}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
            {requests.map((request) => {
              const totalHours = request.entries.reduce(
                (sum, e) => sum + Number(e.hours),
                0,
              );
              const Icon = request.type === "period" ? Clock : FileText;
              return (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setSelectedId(request.id)}
                  className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {requestTitle(request)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t("entriesCount", { count: request.entries.length })}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-gray-900 dark:text-white">
                    {t("hoursShort", { hours: f.hours(totalHours) })}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </PortalShell>
  );
}
