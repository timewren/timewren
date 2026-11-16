"use client";

import { Check, Plus, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { AbsenceRequestForm } from "@/components/enterprise/AbsenceRequestForm";
import { AbsenceRequestList } from "@/components/enterprise/AbsenceRequestList";
import { VacationBalance } from "@/components/enterprise/VacationBalance";
import { VacationLedgerList } from "@/components/enterprise/VacationLedgerList";
import { ModuleGuard } from "@/components/ModuleGuard";
import { Button } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { roleCanWriteTeam, roleSatisfies } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

function AbsencePageContent() {
  const t = useTranslations("enterprise.absence");
  const [showForm, setShowForm] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"mine" | "approve">("mine");
  // Batch-godkendelse (#464)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectingMany, setRejectingMany] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const utils = trpc.useUtils();
  const { data: session } = useSession();

  const { data: myRole } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });
  // hr ser anmodningerne (rang over manager), men hverken registrerer
  // eller godkender (#464)
  const canApprove = roleCanWriteTeam(myRole?.role);
  const canRegisterForOthers =
    roleSatisfies(myRole?.role, "manager") && canApprove;

  const { data: myRequests, isLoading: myLoading } =
    trpc.enterprise.listRequests.useQuery();
  const { data: pendingApprovals, isLoading: approvalsLoading } =
    trpc.enterprise.listRequests.useQuery({ status: "pending" });
  const { data: approvedRequests } = trpc.enterprise.listRequests.useQuery(
    { status: "approved" },
    { enabled: canRegisterForOthers },
  );
  const { data: vacationBalance } =
    trpc.enterprise.getVacationBalance.useQuery();

  // Åbne sygemeldinger (#460) for medarbejdere lederen kan behandle — egne
  // åbne perioder ligger under "Mine anmodninger".
  const openRegistrations = (approvedRequests ?? []).filter(
    (r) => r.endDate === null && r.user?.id !== session?.user?.id,
  );

  const invalidate = () => {
    utils.enterprise.listRequests.invalidate();
    utils.enterprise.getVacationBalance.invalidate();
  };

  const cancelMutation = trpc.enterprise.cancelRequest.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("cancelled"));
    },
    onError: (err) => toast.error(err.message || t("cancelFailed")),
  });

  const approveMutation = trpc.enterprise.approveRequest.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("approved"));
    },
    onError: (err) => toast.error(err.message || t("approveFailed")),
  });

  const rejectMutation = trpc.enterprise.rejectRequest.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("rejected"));
    },
    onError: (err) => toast.error(err.message || t("rejectFailed")),
  });

  const reportWellMutation = trpc.enterprise.reportWell.useMutation({
    onSuccess: () => {
      invalidate();
      utils.enterprise.getBalance.invalidate();
      toast.success(t("reportedWell"));
    },
    onError: (err) => toast.error(err.message || t("reportWellFailed")),
  });

  const reportBatch = (
    kind: "batchApproved" | "batchRejected",
    result: { succeeded: string[]; failed: Array<{ message: string }> },
  ) => {
    invalidate();
    setSelected(new Set());
    if (result.succeeded.length > 0) {
      toast.success(t(kind, { count: result.succeeded.length }));
    }
    for (const f of result.failed.slice(0, 3)) toast.error(f.message);
    if (result.failed.length > 3) {
      toast.error(t("moreErrors", { count: result.failed.length - 3 }));
    }
  };

  const approveMany = trpc.enterprise.approveMany.useMutation({
    onSuccess: (r) => reportBatch("batchApproved", r),
    onError: (err) => toast.error(err.message || t("batchApproveFailed")),
  });
  const rejectMany = trpc.enterprise.rejectMany.useMutation({
    onSuccess: (r) => {
      setRejectingMany(false);
      setRejectReason("");
      reportBatch("batchRejected", r);
    },
    onError: (err) => toast.error(err.message || t("batchRejectFailed")),
  });

  const selectableIds = useMemo(
    () => (pendingApprovals ?? []).map((r) => r.id),
    [pendingApprovals],
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const batchPending = approveMany.isPending || rejectMany.isPending;

  const isLoading = myLoading || approvalsLoading;

  const openForm = (register: boolean) => {
    setRegisterMode(register);
    setEditId(undefined);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex gap-2">
            {canRegisterForOthers && (
              <Button variant="secondary" onClick={() => openForm(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t("registerForEmployee")}
              </Button>
            )}
            <Button onClick={() => openForm(false)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("requestAbsence")}
            </Button>
          </div>
        }
      />

      {/* Vacation balance cards */}
      {vacationBalance &&
        Array.isArray(vacationBalance) &&
        vacationBalance.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {vacationBalance.map((b) => (
              <VacationBalance key={b.id} balance={b} />
            ))}
          </div>
        )}

      {/* Feriebevægelser — ledgeren bag saldoen (#461) */}
      <VacationLedgerList />

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => setActiveTab("mine")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "mine"
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }`}
        >
          {t("tabMine")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("approve")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "approve"
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }`}
        >
          {t("tabApprove")}
          {pendingApprovals && pendingApprovals.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {pendingApprovals.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : activeTab === "mine" ? (
        <AbsenceRequestList
          requests={myRequests ?? []}
          onCancel={(id) => cancelMutation.mutate({ id })}
          onEdit={(id) => {
            setEditId(id);
            setRegisterMode(false);
            setShowForm(true);
          }}
          onReportWell={(requestId, lastSickDate) =>
            reportWellMutation.mutate({ requestId, lastSickDate })
          }
          cancelPending={cancelMutation.isPending}
          reportWellPending={reportWellMutation.isPending}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Batch-handlinger (#464) */}
            {canApprove && selectableIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={
                      selected.size > 0 &&
                      selected.size === selectableIds.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(selectableIds) : new Set(),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                  />
                  {t("selectAll", { count: selectableIds.length })}
                </label>
                {selected.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      disabled={batchPending}
                      onClick={() =>
                        approveMany.mutate({ ids: Array.from(selected) })
                      }
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t("approveSelected", { count: selected.size })}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={batchPending}
                      onClick={() => setRejectingMany(true)}
                    >
                      <X className="mr-1 h-4 w-4" />
                      {t("rejectSelected", { count: selected.size })}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <span />
            )}
            {canRegisterForOthers && (
              <Button variant="secondary" onClick={() => openForm(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t("registerForEmployee")}
              </Button>
            )}
          </div>
          <AbsenceRequestList
            requests={pendingApprovals ?? []}
            showUser
            onApprove={
              canApprove ? (id) => approveMutation.mutate({ id }) : undefined
            }
            onReject={
              canApprove ? (id) => rejectMutation.mutate({ id }) : undefined
            }
            onReportWell={
              canApprove
                ? (requestId, lastSickDate) =>
                    reportWellMutation.mutate({ requestId, lastSickDate })
                : undefined
            }
            approvePending={approveMutation.isPending || batchPending}
            rejectPending={rejectMutation.isPending || batchPending}
            reportWellPending={reportWellMutation.isPending}
            selected={canApprove ? selected : undefined}
            onToggleSelect={canApprove ? toggle : undefined}
          />
          {openRegistrations.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("openSickReports")}
              </h3>
              <AbsenceRequestList
                requests={openRegistrations}
                showUser
                onReportWell={(requestId, lastSickDate) =>
                  reportWellMutation.mutate({ requestId, lastSickDate })
                }
                reportWellPending={reportWellMutation.isPending}
              />
            </div>
          )}
        </div>
      )}

      {rejectingMany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("rejectDialogTitle", { count: selected.size })}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("rejectDialogInfo")}
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={3}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRejectingMany(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={rejectMany.isPending}
                onClick={() =>
                  rejectMany.mutate({
                    ids: Array.from(selected),
                    reason: rejectReason.trim() || undefined,
                  })
                }
              >
                {t("rejectSelectedShort")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <AbsenceRequestForm
          editId={editId}
          registerForEmployee={registerMode}
          onClose={() => {
            setShowForm(false);
            setEditId(undefined);
          }}
          onSuccess={(result) => {
            setShowForm(false);
            setEditId(undefined);
            invalidate();
            toast.success(
              editId
                ? t("requestUpdated")
                : registerMode
                  ? t("registered")
                  : t("requestCreated"),
            );
            if (result?.warning) {
              toast.warning(t("negativeWarning"));
            }
          }}
        />
      )}
    </div>
  );
}

export default function AbsencePage() {
  return (
    <ModuleGuard module="enterprise">
      <AbsencePageContent />
    </ModuleGuard>
  );
}
