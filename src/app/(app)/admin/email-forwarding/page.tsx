"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MailX,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

interface RuleFormData {
  name: string;
  description: string;
  fromPattern: string;
  toAddress: string;
  toPattern: string;
  subjectPrefix: string;
  forwardAttachments: boolean;
  isActive: boolean;
}

const emptyForm: RuleFormData = {
  name: "",
  description: "",
  fromPattern: "*",
  toAddress: "",
  toPattern: "",
  subjectPrefix: "",
  forwardAttachments: true,
  isActive: true,
};

export default function EmailForwardingPage() {
  const [rulesPage, setRulesPage] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [logStatus, setLogStatus] = useState<
    "forwarded" | "failed" | "no_match" | "skipped" | undefined
  >(undefined);
  const [logDaysBack, setLogDaysBack] = useState(7);
  const [showModal, setShowModal] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const rulesLimit = 20;
  const logsLimit = 20;

  const _utils = trpc.useUtils();

  const {
    data: rulesData,
    isLoading: rulesLoading,
    refetch: refetchRules,
  } = trpc.emailForwarding.listRules.useQuery({
    limit: rulesLimit,
    offset: rulesPage * rulesLimit,
  });

  const { data: stats, refetch: refetchStats } =
    trpc.emailForwarding.getLogStats.useQuery({
      daysBack: logDaysBack,
    });

  const {
    data: logsData,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = trpc.emailForwarding.listLogs.useQuery({
    limit: logsLimit,
    offset: logsPage * logsLimit,
    status: logStatus,
    daysBack: logDaysBack,
  });

  const createMutation = trpc.emailForwarding.createRule.useMutation({
    onSuccess: () => {
      setShowModal(false);
      setFormData(emptyForm);
      refetchRules();
      refetchStats();
    },
  });

  const updateMutation = trpc.emailForwarding.updateRule.useMutation({
    onSuccess: () => {
      setShowModal(false);
      setEditingRuleId(null);
      setFormData(emptyForm);
      refetchRules();
    },
  });

  const deleteMutation = trpc.emailForwarding.deleteRule.useMutation({
    onSuccess: () => {
      setDeleteConfirm(null);
      refetchRules();
      refetchStats();
    },
  });

  const toggleMutation = trpc.emailForwarding.toggleRule.useMutation({
    onSuccess: () => {
      refetchRules();
      refetchStats();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRuleId) {
      updateMutation.mutate({
        id: editingRuleId,
        name: formData.name,
        description: formData.description || undefined,
        fromPattern: formData.fromPattern || "*",
        toAddress: formData.toAddress,
        toPattern: formData.toPattern || undefined,
        subjectPrefix: formData.subjectPrefix || undefined,
        forwardAttachments: formData.forwardAttachments,
        isActive: formData.isActive,
      });
    } else {
      createMutation.mutate({
        name: formData.name,
        description: formData.description || undefined,
        fromPattern: formData.fromPattern || "*",
        toAddress: formData.toAddress,
        toPattern: formData.toPattern || undefined,
        subjectPrefix: formData.subjectPrefix || undefined,
        forwardAttachments: formData.forwardAttachments,
        isActive: formData.isActive,
      });
    }
  };

  const openEditModal = (rule: NonNullable<typeof rulesData>["rules"][0]) => {
    setEditingRuleId(rule.id);
    setFormData({
      name: rule.name,
      description: rule.description || "",
      fromPattern: rule.fromPattern,
      toAddress: rule.toAddress,
      toPattern: rule.toPattern || "",
      subjectPrefix: rule.subjectPrefix || "",
      forwardAttachments: rule.forwardAttachments,
      isActive: rule.isActive,
    });
    setShowAdvanced(
      rule.fromPattern !== "*" ||
        !!rule.description ||
        !!rule.subjectPrefix ||
        !rule.forwardAttachments ||
        !rule.isActive,
    );
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditingRuleId(null);
    setFormData(emptyForm);
    setShowAdvanced(false);
    setShowModal(true);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("da-DK", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const formatRelativeDate = (date: Date | string | null) => {
    if (!date) return "Aldrig";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Lige nu";
    if (diffMins < 60) return `${diffMins} min. siden`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} t. siden`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} d. siden`;
    return formatDate(date);
  };

  const refetchAll = () => {
    refetchRules();
    refetchStats();
    refetchLogs();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            E-mail Videresendelse
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Administrer regler for automatisk videresendelse af indgående emails
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refetchAll}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <RefreshCw className="h-4 w-4" />
            Opdater
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            Opret regel
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-brand-50 p-4 dark:bg-tt-gran-lys">
          <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">
            {stats?.activeRules ?? 0}
          </p>
          <p className="text-sm text-brand-700 dark:text-brand-300">
            Aktive regler
          </p>
        </div>
        <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
            {stats?.forwarded ?? 0}
          </p>
          <p className="text-sm text-green-700 dark:text-green-300">
            Videresendt ({logDaysBack} dage)
          </p>
        </div>
        <div className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
          <p className="text-3xl font-bold text-red-600 dark:text-red-400">
            {stats?.failed ?? 0}
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">
            Fejlet ({logDaysBack} dage)
          </p>
        </div>
        <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
          <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
            {stats?.no_match ?? 0}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Umatchede ({logDaysBack} dage)
          </p>
        </div>
      </div>

      {/* Rules table */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
          Regler
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          {rulesLoading ? (
            <div className="flex items-center justify-center py-12">
              <InlineSpinner className="h-8 w-8" />
            </div>
          ) : !rulesData?.rules.length ? (
            <div className="py-12 text-center text-gray-500">
              <Mail className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2">Ingen regler oprettet endnu</p>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                Opret din første regel
              </button>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Navn
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Modtager
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Videresend til
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Aktiv
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Matches
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Sidst matchet
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Handlinger
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rulesData.rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {rule.name}
                        </span>
                        {rule.fromPattern && rule.fromPattern !== "*" && (
                          <span className="ml-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            fra: {rule.fromPattern}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {rule.toPattern ? (
                        <span className="inline-flex rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                          {rule.toPattern}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">*</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {rule.toAddress}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <button
                        type="button"
                        onClick={() => toggleMutation.mutate({ id: rule.id })}
                        disabled={toggleMutation.isPending}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                          rule.isActive
                            ? "bg-brand-600"
                            : "bg-gray-200 dark:bg-gray-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            rule.isActive ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {rule.matchCount}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {formatRelativeDate(rule.lastMatchedAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(rule)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                          title="Rediger"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {deleteConfirm === rule.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                deleteMutation.mutate({ id: rule.id })
                              }
                              disabled={deleteMutation.isPending}
                              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                            >
                              Bekræft
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(null)}
                              className="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Annuller
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(rule.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                            title="Slet"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Rules pagination */}
        {rulesData && rulesData.total > rulesLimit && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Viser {rulesPage * rulesLimit + 1}-
              {Math.min((rulesPage + 1) * rulesLimit, rulesData.total)} af{" "}
              {rulesData.total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRulesPage(rulesPage - 1)}
                disabled={rulesPage === 0}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <ChevronLeft className="h-4 w-4" />
                Forrige
              </button>
              <button
                type="button"
                onClick={() => setRulesPage(rulesPage + 1)}
                disabled={(rulesPage + 1) * rulesLimit >= rulesData.total}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                Næste
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Logs section */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
          Logs
        </h2>

        {/* Log filters */}
        <div className="mb-4 flex flex-wrap gap-4">
          <select
            value={logDaysBack}
            onChange={(e) => {
              setLogDaysBack(Number(e.target.value));
              setLogsPage(0);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value={1}>Sidste 24 timer</option>
            <option value={7}>Sidste 7 dage</option>
            <option value={30}>Sidste 30 dage</option>
            <option value={90}>Sidste 90 dage</option>
          </select>

          <select
            value={logStatus ?? ""}
            onChange={(e) => {
              setLogStatus(
                (e.target.value as
                  | "forwarded"
                  | "failed"
                  | "no_match"
                  | "skipped") || undefined,
              );
              setLogsPage(0);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">Alle statusser</option>
            <option value="forwarded">Videresendt</option>
            <option value="failed">Fejlet</option>
            <option value="no_match">Umatchet</option>
            <option value="skipped">Sprunget over</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          {logsLoading ? (
            <div className="flex items-center justify-center py-12">
              <InlineSpinner className="h-8 w-8" />
            </div>
          ) : !logsData?.logs.length ? (
            <div className="py-12 text-center text-gray-500">
              <MailX className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2">Ingen logs fundet</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Tidspunkt
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Fra
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Til
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Emne
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Regel
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {logsData.logs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(log.receivedAt)}
                    </td>
                    <td className="max-w-[200px] truncate px-6 py-4 text-sm text-gray-900 dark:text-white">
                      {log.fromAddress}
                    </td>
                    <td className="max-w-[200px] truncate px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {log.toAddress || "-"}
                    </td>
                    <td className="max-w-[250px] truncate px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {log.subject || "-"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          log.status === "forwarded"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : log.status === "failed"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : log.status === "no_match"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {log.status === "forwarded" ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : log.status === "failed" ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <AlertCircle className="h-3 w-3" />
                        )}
                        {log.status === "forwarded"
                          ? "Videresendt"
                          : log.status === "failed"
                            ? "Fejlet"
                            : log.status === "no_match"
                              ? "Umatchet"
                              : "Sprunget over"}
                      </span>
                      {log.status === "failed" && log.errorMessage && (
                        <p
                          className="mt-1 max-w-[200px] truncate text-xs text-red-600 dark:text-red-400"
                          title={log.errorMessage}
                        >
                          {log.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {log.ruleName || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Logs pagination */}
        {logsData && logsData.total > logsLimit && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Viser {logsPage * logsLimit + 1}-
              {Math.min((logsPage + 1) * logsLimit, logsData.total)} af{" "}
              {logsData.total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLogsPage(logsPage - 1)}
                disabled={logsPage === 0}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                <ChevronLeft className="h-4 w-4" />
                Forrige
              </button>
              <button
                type="button"
                onClick={() => setLogsPage(logsPage + 1)}
                disabled={(logsPage + 1) * logsLimit >= logsData.total}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                Næste
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingRuleId ? "Rediger regel" : "Opret regel"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setEditingRuleId(null);
                  setFormData(emptyForm);
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 1. Modtager-adresse (toPattern) */}
              <div>
                <label
                  htmlFor="rule-to-pattern"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Modtager-adresse *
                </label>
                <input
                  id="rule-to-pattern"
                  type="text"
                  required
                  value={formData.toPattern}
                  onChange={(e) =>
                    setFormData({ ...formData, toPattern: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="support@timetrack.dk"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Adressen der modtager emails, fx{" "}
                  <code className="rounded bg-gray-100 px-1 dark:bg-gray-600">
                    support@timetrack.dk
                  </code>
                </p>
              </div>

              {/* 2. Videresend til (toAddress) */}
              <div>
                <label
                  htmlFor="rule-to-address"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Videresend til *
                </label>
                <input
                  id="rule-to-address"
                  type="email"
                  required
                  value={formData.toAddress}
                  onChange={(e) =>
                    setFormData({ ...formData, toAddress: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="support@firma.herodesk-mails.io"
                />
              </div>

              {/* 3. Navn */}
              <div>
                <label
                  htmlFor="rule-name"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Navn *
                </label>
                <input
                  id="rule-name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="F.eks. Support-emails"
                />
              </div>

              {/* Avanceret sektion */}
              <div className="border-t border-gray-200 pt-3 dark:border-gray-600">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex w-full items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  />
                  Avanceret
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-4">
                    {/* Fra-mønster */}
                    <div>
                      <label
                        htmlFor="rule-from-pattern"
                        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >
                        Fra-mønster
                      </label>
                      <input
                        id="rule-from-pattern"
                        type="text"
                        value={formData.fromPattern}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            fromPattern: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        placeholder="* (matcher alle afsendere)"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Brug * som wildcard. Standard: * (alle afsendere)
                      </p>
                    </div>

                    {/* Beskrivelse */}
                    <div>
                      <label
                        htmlFor="rule-description"
                        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >
                        Beskrivelse
                      </label>
                      <textarea
                        id="rule-description"
                        value={formData.description}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            description: e.target.value,
                          })
                        }
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        placeholder="Valgfri beskrivelse"
                      />
                    </div>

                    {/* Emne-prefix */}
                    <div>
                      <label
                        htmlFor="rule-subject-prefix"
                        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >
                        Emne-prefix
                      </label>
                      <input
                        id="rule-subject-prefix"
                        type="text"
                        value={formData.subjectPrefix}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            subjectPrefix: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        placeholder="[Fwd] "
                      />
                    </div>

                    {/* Checkboxes */}
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={formData.forwardAttachments}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              forwardAttachments: e.target.checked,
                            })
                          }
                          className="rounded border-gray-300"
                        />
                        Videresend vedhæftninger
                      </label>

                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={formData.isActive}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              isActive: e.target.checked,
                            })
                          }
                          className="rounded border-gray-300"
                        />
                        Aktiv
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {(createMutation.error || updateMutation.error) && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {createMutation.error?.message ||
                    updateMutation.error?.message}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingRuleId(null);
                    setFormData(emptyForm);
                  }}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
                >
                  Annuller
                </button>
                <button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                  className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Gemmer..."
                    : editingRuleId
                      ? "Gem ændringer"
                      : "Opret regel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
