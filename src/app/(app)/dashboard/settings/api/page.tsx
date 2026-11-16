"use client";

import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { ConfirmDialog, ModuleDisabledState } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { RESOURCES, type Scope } from "@/lib/api/scopes";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import { trpc } from "@/providers/trpc-provider";

// --- Helpers ---

type Translator = ReturnType<typeof useTranslations>;

function relativeTime(date: Date | null | undefined, t: Translator): string {
  if (!date) return t("relNever");
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("relNow");
  if (mins < 60) return t("relMinutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("relHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("relDays", { count: days });
  const months = Math.floor(days / 30);
  return t("relMonths", { count: months });
}

function formatDate(date: Date | string, locale: string): string {
  return new Date(date).toLocaleDateString(toIntlLocale(locale));
}

const PERMISSION_KEYS: Record<string, string> = {
  read: "permRead",
  write: "permWrite",
  all: "permAll",
};

// --- Scope selector sub-component ---

function ScopeSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (scopes: string[]) => void;
}) {
  const t = useTranslations("settingsApi");
  const fullAccess = selected.includes("*");

  function toggleFullAccess() {
    if (fullAccess) {
      onChange([]);
    } else {
      onChange(["*"]);
    }
  }

  function toggleScope(scope: string) {
    if (selected.includes(scope)) {
      onChange(selected.filter((s) => s !== scope));
    } else {
      onChange([...selected, scope]);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={fullAccess}
          onChange={toggleFullAccess}
          className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          {t("fullAccess")}{" "}
          <span className="font-mono text-xs text-gray-500">(*)</span>
        </span>
      </label>

      {!fullAccess && (
        <div className="ml-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("resource")}
                </th>
                {(["read", "write", "all"] as const).map((perm) => (
                  <th
                    key={perm}
                    className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {t(PERMISSION_KEYS[perm])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {RESOURCES.map((resource) => (
                <tr
                  key={resource}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                    {t.has(`resources.${resource}`)
                      ? t(`resources.${resource}`)
                      : resource}
                  </td>
                  {(["read", "write", "all"] as const).map((perm) => {
                    const scope = `${resource}:${perm}` as Scope;
                    return (
                      <td key={perm} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected.includes(scope)}
                          onChange={() => toggleScope(scope)}
                          className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Create dialog ---

function CreateKeyDialog({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const t = useTranslations("settingsApi");
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["*"]);
  const [expiresAt, setExpiresAt] = useState("");

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      utils.apiKeys.list.invalidate();
      setName("");
      setScopes(["*"]);
      setExpiresAt("");
      onCreated(data.key);
    },
    onError: (err) => {
      toast.error(t("error", { message: err.message }));
    },
  });

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    if (scopes.length === 0) {
      toast.error(t("scopeRequired"));
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      scopes: scopes as Scope[],
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onClose}
        aria-label={t("closeDialog")}
      />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("createTitle")}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("createSub")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label
              htmlFor="key-name"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              {t("name")}
            </label>
            <input
              id="key-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("scopes")}
            </p>
            <ScopeSelector selected={scopes} onChange={setScopes} />
          </div>

          <div>
            <label
              htmlFor="expires-at"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              {t.rich("expires", {
                hint: (chunks) => (
                  <span className="text-gray-400 font-normal">{chunks}</span>
                ),
              })}
            </label>
            <input
              id="expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={(() => {
                const today = new Date();
                return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
              })()}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {createMutation.isPending && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {t("createKey")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- New key reveal dialog ---

function NewKeyReveal({
  apiKey,
  onDismiss,
}: {
  apiKey: string;
  onDismiss: () => void;
}) {
  const t = useTranslations("settingsApi");
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("newKeyTitle")}
              </h2>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                {t("newKeyWarning")}
              </p>
            </div>
          </div>

          <div className="relative bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-4 font-mono text-sm break-all">
            <span className={revealed ? "select-all" : "blur-sm select-none"}>
              {apiKey}
            </span>
            <div className="absolute top-2 right-2 flex gap-1">
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                title={revealed ? t("hideKey") : t("showKey")}
                className="p-1.5 rounded bg-white dark:bg-gray-800 shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {revealed ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                title={t("copyKey")}
                className="p-1.5 rounded bg-white dark:bg-gray-800 shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              {t("understood")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Scope badges ---

function ScopeBadges({ scopes }: { scopes: string[] }) {
  const t = useTranslations("settingsApi");
  if (scopes.includes("*")) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
        {t("fullAccess")}
      </span>
    );
  }
  const display = scopes.slice(0, 3);
  const rest = scopes.length - display.length;
  return (
    <div className="flex flex-wrap gap-1">
      {display.map((s) => (
        <span
          key={s}
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {s}
        </span>
      ))}
      {rest > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          +{rest}
        </span>
      )}
    </div>
  );
}

// --- Main page ---

export default function ApiKeysPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsApi");
  const locale = useLocale();
  const utils = trpc.useUtils();

  const {
    data: keys,
    isLoading,
    error: keysError,
  } = trpc.apiKeys.list.useQuery();

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      toast.success(t("revoked"));
      setRevokeId(null);
    },
    onError: (err) => {
      toast.error(t("error", { message: err.message }));
      setRevokeId(null);
    },
  });

  const deleteMutation = trpc.apiKeys.delete.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      toast.success(t("deleted"));
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error(t("error", { message: err.message }));
      setDeleteId(null);
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Modulet "Public API" er slået fra: sig det, i stedet for en tom liste
  // med en Opret-knap, som serveren afviser.
  if (isModuleDisabledError(keysError)) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription", { brand: brand.name })}
        />
        <ModuleDisabledState
          title={t("disabledTitle")}
          description={t("disabledText")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription", { brand: brand.name })}
      />

      <div className="p-6 max-w-5xl space-y-6">
        {/* Header card */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {t("cardTitle")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t.rich("cardText", {
                    brand: brand.name,
                    link: (chunks) => (
                      <a
                        href="/api/v1/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-medium"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("createKey")}
            </button>
          </div>
        </div>

        {/* Keys list */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <LoadingScreen message={t("loadingKeys")} showTip={false} />
            </div>
          ) : !keys || keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <Key className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">
                {t("emptyTitle")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
                {t("emptyText", { brand: brand.name })}
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t("createKey")}
                </button>
                <a
                  href="/api/v1/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  {t("viewDocs")}
                </a>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colName")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colKey")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colScopes")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colLastUsed")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colCreated")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t("colStatus")}
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {keys.map((k) => (
                    <tr
                      key={k.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {k.name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
                          {k.keyPrefix}...
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <ScopeBadges scopes={k.scopes} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {relativeTime(k.lastUsedAt, t)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(k.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3">
                        {k.isRevoked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            <XCircle className="w-3 h-3" />
                            {t("statusRevoked")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <Check className="w-3 h-3" />
                            {t("statusActive")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {!k.isRevoked && (
                            <button
                              type="button"
                              onClick={() => setRevokeId(k.id)}
                              title={t("revokeKey")}
                              className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeleteId(k.id)}
                            title={t("deleteKey")}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <CreateKeyDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(key) => {
          setShowCreate(false);
          setNewKey(key);
        }}
      />

      {/* New key reveal */}
      {newKey && (
        <NewKeyReveal apiKey={newKey} onDismiss={() => setNewKey(null)} />
      )}

      {/* Revoke confirm */}
      <ConfirmDialog
        isOpen={!!revokeId}
        onClose={() => setRevokeId(null)}
        onConfirm={() => {
          if (revokeId) revokeMutation.mutate({ id: revokeId });
          // dialog closes via mutation callback
        }}
        title={t("revokeTitle")}
        description={t("revokeText")}
        confirmLabel={t("revokeConfirm")}
        variant="warning"
        isLoading={revokeMutation.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId });
          // dialog closes via mutation callback
        }}
        title={t("deleteTitle")}
        description={t("deleteText")}
        confirmLabel={t("deleteConfirm")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
