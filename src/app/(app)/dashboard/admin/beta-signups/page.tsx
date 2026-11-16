"use client";

import {
  CalendarDays,
  Clock,
  Mail,
  Search,
  Send,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import {
  AdminTable,
  type AdminTableColumn,
} from "@/components/admin/AdminTable";
import { trpc } from "@/providers/trpc-provider";

type BetaStatus = "pending" | "invited" | "registered" | "rejected";

const statusLabels: Record<BetaStatus, string> = {
  pending: "Afventende",
  invited: "Inviteret",
  registered: "Registreret",
  rejected: "Afvist",
};

const statusColors: Record<BetaStatus, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  invited: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  registered:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const toolLabels: Record<string, string> = {
  effihub: "EffiHub",
  excel: "Excel/Regneark",
  andet: "Andet",
  ingen: "Intet",
};

type SignupRow = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  currentTool: string | null;
  message: string | null;
  status: string | null;
  referralSource: string | null;
  createdAt: Date;
};

export default function BetaSignupsPage() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BetaStatus>("all");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailSignup, setEmailSignup] = useState<SignupRow | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [customMessage, setCustomMessage] = useState("");

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const pageSize = 50;

  const { data: stats } = trpc.betaSignup.adminStats.useQuery();
  const { data: listData, isLoading } = trpc.betaSignup.adminList.useQuery({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    page: page + 1, // AdminTable uses 0-based, tRPC uses 1-based
    pageSize,
  });

  const updateStatusMutation = trpc.betaSignup.adminUpdateStatus.useMutation({
    onSuccess: () => {
      utils.betaSignup.adminList.invalidate();
      utils.betaSignup.adminStats.invalidate();
      setSelectedIds(new Set());
      toast.success("Status opdateret");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.betaSignup.adminDelete.useMutation({
    onSuccess: (data) => {
      utils.betaSignup.adminList.invalidate();
      utils.betaSignup.adminStats.invalidate();
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      toast.success(`${data.deleted} tilmelding(er) slettet`);
    },
    onError: (err) => toast.error(err.message),
  });

  const sendEmailMutation = trpc.betaSignup.adminSendEmail.useMutation({
    onSuccess: (data) => {
      utils.betaSignup.adminList.invalidate();
      utils.betaSignup.adminStats.invalidate();
      setEmailDialogOpen(false);
      setEmailSignup(null);
      setDiscountCode("");
      setCustomMessage("");
      toast.success(`Invitation sendt til ${data.email}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const items = listData?.items ?? [];

  const columns: AdminTableColumn<SignupRow>[] = [
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <span className="font-medium text-gray-900 dark:text-white">
          {row.email}
        </span>
      ),
    },
    {
      key: "name",
      header: "Navn",
      render: (row) => (
        <span className="text-gray-600 dark:text-gray-300">
          {row.name || "–"}
        </span>
      ),
    },
    {
      key: "company",
      header: "Virksomhed",
      render: (row) => (
        <span className="text-gray-600 dark:text-gray-300">
          {row.company || "–"}
        </span>
      ),
    },
    {
      key: "currentTool",
      header: "Værktøj",
      render: (row) => (
        <span className="text-gray-600 dark:text-gray-300">
          {row.currentTool
            ? (toolLabels[row.currentTool] ?? row.currentTool)
            : "–"}
        </span>
      ),
    },
    {
      key: "message",
      header: "Besked",
      className: "max-w-[200px]",
      render: (row) => (
        <span
          className="text-gray-500 dark:text-gray-400 text-sm truncate block max-w-[200px]"
          title={row.message ?? undefined}
        >
          {row.message || "–"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const status = (row.status as BetaStatus) || "pending";
        return (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status]}`}
          >
            {statusLabels[status]}
          </span>
        );
      },
    },
    {
      key: "createdAt",
      header: "Dato",
      render: (row) => (
        <span className="text-gray-500 dark:text-gray-400 text-sm whitespace-nowrap">
          {new Date(row.createdAt).toLocaleDateString("da-DK", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEmailSignup(row);
              setEmailDialogOpen(true);
            }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-tt-gran-lys dark:hover:text-brand-400 transition-colors"
            title="Send invitation"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const handleBulkStatusChange = (status: BetaStatus) => {
    if (selectedIds.size === 0) return;
    updateStatusMutation.mutate({ ids: Array.from(selectedIds), status });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirmOpen(true);
  };

  const confirmBulkDelete = () => {
    deleteMutation.mutate({ ids: Array.from(selectedIds) });
  };

  const handleSendEmail = () => {
    if (!emailSignup) return;
    sendEmailMutation.mutate({
      signupId: emailSignup.id,
      discountCode: discountCode || undefined,
      customMessage: customMessage || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Beta-tilmeldinger
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Administrer beta-tilmeldinger og send invitationer
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <AdminStatCard
          label="Total"
          value={stats?.total ?? 0}
          icon={Users}
          color="blue"
        />
        <AdminStatCard
          label="Afventende"
          value={stats?.pending ?? 0}
          icon={Clock}
          color="amber"
        />
        <AdminStatCard
          label="Inviteret"
          value={stats?.invited ?? 0}
          icon={Mail}
          color="purple"
        />
        <AdminStatCard
          label="Denne uge"
          value={stats?.thisWeek ?? 0}
          icon={CalendarDays}
          color="green"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Søg email, navn, virksomhed..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "all" | BetaStatus);
              setPage(0);
            }}
            className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="all">Alle statuser</option>
            <option value="pending">Afventende</option>
            <option value="invited">Inviteret</option>
            <option value="registered">Registreret</option>
            <option value="rejected">Afvist</option>
          </select>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {selectedIds.size} valgt
            </span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleBulkStatusChange(e.target.value as BetaStatus);
                  e.target.value = "";
                }
              }}
              defaultValue=""
              className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
            >
              <option value="" disabled>
                Skift status...
              </option>
              <option value="pending">Afventende</option>
              <option value="invited">Inviteret</option>
              <option value="registered">Registreret</option>
              <option value="rejected">Afvist</option>
            </select>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Slet
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <AdminTable<SignupRow>
        columns={columns}
        data={items}
        total={listData?.total ?? 0}
        page={page}
        limit={pageSize}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyIcon={UserPlus}
        emptyMessage="Ingen beta-tilmeldinger fundet"
        rowKey={(row) => row.id}
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
      />

      {/* Email dialog */}
      {emailDialogOpen && emailSignup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Send invitation
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Til: <strong>{emailSignup.email}</strong>
              {emailSignup.name && ` (${emailSignup.name})`}
            </p>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="beta-discount-code"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Rabatkode (valgfrit)
                </label>
                <input
                  id="beta-discount-code"
                  type="text"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  placeholder="F.eks. BETA50"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>

              <div>
                <label
                  htmlFor="beta-custom-message"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Brugerdefineret besked (valgfrit)
                </label>
                <textarea
                  id="beta-custom-message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Erstat standard-beskeden med din egen tekst..."
                  rows={4}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Lad feltet stå tomt for at bruge standard invitations-teksten.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEmailDialogOpen(false);
                  setEmailSignup(null);
                  setDiscountCode("");
                  setCustomMessage("");
                }}
                className="rounded-lg border border-gray-200 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Annuller
              </button>
              <button
                type="button"
                onClick={handleSendEmail}
                disabled={sendEmailMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 transition-colors"
              >
                <Send className="h-4 w-4" />
                {sendEmailMutation.isPending ? "Sender..." : "Send invitation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Bekræft sletning
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedIds.size} tilmelding(er) slettes permanent.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Annuller
              </button>
              <button
                type="button"
                onClick={confirmBulkDelete}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? "Sletter..." : "Slet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
