"use client";

import {
  Bell,
  Flag,
  Loader2,
  Mail,
  Megaphone,
  Pencil,
  Plus,
  RadioTower,
  Save,
  TestTube,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  readElectricBadgeEnabled,
  writeElectricBadgeEnabled,
} from "@/lib/electric/badgePreference";
import { trpc } from "@/providers/trpc-provider";

/** Sanitize signature HTML — allow common formatting tags + inline styles */
function sanitizeSignatureHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "a",
      "img",
      "div",
      "span",
      "table",
      "tr",
      "td",
      "th",
      "hr",
      "b",
      "i",
      "u",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "style"],
      img: ["src", "alt", "width", "height", "style"],
      "*": ["style", "class"],
    },
  });
}

// Event type toggles configuration
const eventTypes = [
  {
    key: "notify_signup",
    channels: ["email", "discord"],
  },
  {
    key: "notify_subscription_started",
    channels: ["email", "discord"],
  },
  {
    key: "notify_payment_failed",
    channels: ["email", "discord"],
  },
  {
    key: "notify_subscription_cancelled",
    channels: ["email", "discord"],
  },
  {
    key: "notify_trial_ending",
    channels: ["discord"],
  },
  {
    key: "notify_user_flagged",
    channels: ["discord"],
  },
] as const;

type SettingsState = {
  notification_email: string;
  discord_webhook_url: string;
  [key: string]: string;
};

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-brand-600" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function SupportSettingsSection() {
  const t = useTranslations("adminSettings");
  const utils = trpc.useUtils();
  const { data: inboxes, isLoading: loadingInboxes } =
    trpc.admin.getInboxes.useQuery();
  const { data: globalSignature } = trpc.admin.getSignature.useQuery();

  const [signatureText, setSignatureText] = useState("");
  const [showNewInbox, setShowNewInbox] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newSignature, setNewSignature] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editSignature, setEditSignature] = useState("");

  useEffect(() => {
    if (globalSignature !== undefined) {
      setSignatureText(globalSignature);
    }
  }, [globalSignature]);

  const createInbox = trpc.admin.createInbox.useMutation({
    onSuccess: () => {
      utils.admin.getInboxes.invalidate();
      setShowNewInbox(false);
      setNewEmail("");
      setNewName("");
      setNewColor("#3b82f6");
      setNewSignature("");
      toast.success(t("support.inboxCreated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const updateInbox = trpc.admin.updateInbox.useMutation({
    onSuccess: () => {
      utils.admin.getInboxes.invalidate();
      setEditingId(null);
      toast.success(t("support.inboxUpdated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteInbox = trpc.admin.deleteInbox.useMutation({
    onSuccess: () => {
      utils.admin.getInboxes.invalidate();
      toast.success(t("support.inboxDeleted"));
    },
    onError: (err) => toast.error(err.message),
  });

  const updateSignature = trpc.admin.updateSignature.useMutation({
    onSuccess: () => {
      utils.admin.getSignature.invalidate();
      toast.success(t("support.signatureSaved"));
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <SettingsSection
      title={t("support.title")}
      description={t("support.description")}
      icon={Mail}
    >
      <div className="space-y-6">
        {/* Inboxes */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">
              {t("support.inboxes")}
            </h3>
            <button
              type="button"
              onClick={() => setShowNewInbox(true)}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3 w-3" />
              {t("support.add")}
            </button>
          </div>

          {loadingInboxes ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-2">
              {inboxes?.map((inbox) =>
                editingId === inbox.id ? (
                  <div
                    key={inbox.id}
                    className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3"
                  >
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t("support.namePlaceholder")}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-8 w-10 cursor-pointer rounded border border-gray-300"
                      />
                    </div>
                    <textarea
                      value={editSignature}
                      onChange={(e) => setEditSignature(e.target.value)}
                      placeholder={t("support.signaturePlaceholder")}
                      rows={2}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateInbox.mutate({
                            id: inbox.id,
                            name: editName,
                            color: editColor,
                            signature: editSignature || null,
                          })
                        }
                        className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        {t("support.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        {t("support.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={inbox.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: inbox.color }}
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {inbox.name}
                        </p>
                        <p className="text-xs text-gray-500">{inbox.email}</p>
                      </div>
                      {inbox.isDefault && (
                        <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-xs text-brand-600">
                          {t("support.default")}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(inbox.id);
                          setEditName(inbox.name);
                          setEditColor(inbox.color);
                          setEditSignature(inbox.signature ?? "");
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t("support.confirmDelete"))) {
                            deleteInbox.mutate({ id: inbox.id });
                          }
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ),
              )}

              {(!inboxes || inboxes.length === 0) && !showNewInbox && (
                <p className="py-3 text-center text-xs text-gray-400">
                  {t("support.noInboxes")}
                </p>
              )}
            </div>
          )}

          {/* New inbox form */}
          {showNewInbox && (
            <div className="mt-2 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@domain.dk"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("support.namePlaceholder")}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-gray-300"
                />
              </div>
              <textarea
                value={newSignature}
                onChange={(e) => setNewSignature(e.target.value)}
                placeholder={t("support.signaturePlaceholder")}
                rows={2}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    createInbox.mutate({
                      email: newEmail,
                      name: newName,
                      color: newColor,
                      signature: newSignature || null,
                    })
                  }
                  disabled={!newEmail || !newName}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {t("support.create")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewInbox(false)}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  {t("support.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global signature */}
        <div className="border-t border-gray-100 pt-4">
          <h3 className="mb-2 text-sm font-medium text-gray-700">
            {t("support.globalSignature")}
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            {t("support.globalSignatureHint")}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <textarea
                value={signatureText}
                onChange={(e) => setSignatureText(e.target.value)}
                placeholder={t("support.globalSignaturePlaceholder")}
                rows={5}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-400">
                {t("support.preview")}
              </p>
              <div
                className="min-h-[100px] rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized signature preview
                dangerouslySetInnerHTML={{
                  __html: signatureText
                    ? sanitizeSignatureHtml(signatureText)
                    : `<span class="text-gray-300">${t("support.noSignature")}</span>`,
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() =>
                updateSignature.mutate({ signature: signatureText })
              }
              disabled={updateSignature.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {updateSignature.isPending
                ? t("support.savingSignature")
                : t("support.saveSignature")}
            </button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function DebugSection() {
  const t = useTranslations("adminSettings");
  const [electricBadge, setElectricBadge] = useState(false);

  useEffect(() => {
    setElectricBadge(readElectricBadgeEnabled());
  }, []);

  return (
    <SettingsSection
      title={t("debug.title")}
      description={t("debug.description")}
      icon={RadioTower}
    >
      <Toggle
        checked={electricBadge}
        onChange={(enabled) => {
          writeElectricBadgeEnabled(enabled);
          setElectricBadge(enabled);
        }}
        label={t("debug.electricLabel")}
        description={t("debug.electricDescription")}
      />
    </SettingsSection>
  );
}

function FeatureFlagsSection() {
  const t = useTranslations("adminSettings");
  const locale = useLocale();
  const { data: flags, isLoading } = trpc.admin.getFeatureFlags.useQuery();
  const utils = trpc.useUtils();

  const toggleMutation = trpc.admin.toggleFeatureFlag.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.admin.getFeatureFlags.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <SettingsSection
      title={t("flags.title")}
      description={t("flags.description")}
      icon={Flag}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : !flags || flags.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          {t("flags.empty")}
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="flex items-center justify-between py-3"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{flag.key}</p>
                {flag.description && (
                  <p className="text-xs text-gray-500">{flag.description}</p>
                )}
                {flag.updater && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {flag.updatedAt
                      ? t("flags.lastChangedByDate", {
                          name: flag.updater.name ?? "",
                          date: new Date(flag.updatedAt).toLocaleDateString(
                            toIntlLocale(locale),
                          ),
                        })
                      : t("flags.lastChangedBy", {
                          name: flag.updater.name ?? "",
                        })}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                onClick={() =>
                  toggleMutation.mutate({
                    key: flag.key,
                    enabled: !flag.enabled,
                  })
                }
                disabled={toggleMutation.isPending}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  flag.enabled ? "bg-brand-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    flag.enabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function ChangelogSection() {
  const t = useTranslations("adminSettings");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data: entries } = trpc.admin.listChangelogs.useQuery();

  const createChangelog = trpc.admin.createChangelog.useMutation({
    onSuccess: () => {
      utils.admin.listChangelogs.invalidate();
      setVersion("");
      setTitle("");
      setContent("");
      setShowForm(false);
      toast.success(t("changelog.created"));
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteChangelog = trpc.admin.deleteChangelog.useMutation({
    onSuccess: () => {
      utils.admin.listChangelogs.invalidate();
      toast.success(t("changelog.deleted"));
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!version.trim() || !title.trim() || !content.trim()) return;
    createChangelog.mutate({
      version: version.trim(),
      title: title.trim(),
      content: content.trim(),
    });
  };

  return (
    <SettingsSection
      title={t("changelog.title")}
      description={t("changelog.description")}
      icon={Megaphone}
    >
      {!showForm ? (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" />
            {t("changelog.new")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="cl-version"
              className="block text-sm font-medium text-gray-700"
            >
              {t("changelog.version")}
            </label>
            <input
              id="cl-version"
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.5.0"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label
              htmlFor="cl-title"
              className="block text-sm font-medium text-gray-700"
            >
              {t("changelog.titleLabel")}
            </label>
            <input
              id="cl-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("changelog.titlePlaceholder")}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label
              htmlFor="cl-content"
              className="block text-sm font-medium text-gray-700"
            >
              {t("changelog.content")}
            </label>
            <textarea
              id="cl-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder={t("changelog.contentPlaceholder")}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              {t("changelog.cancel")}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={
                !version.trim() ||
                !title.trim() ||
                !content.trim() ||
                createChangelog.isPending
              }
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createChangelog.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {t("changelog.create")}
            </button>
          </div>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-6 border-t border-gray-100 pt-4">
          <h3 className="mb-3 text-sm font-medium text-gray-700">
            {t("changelog.recent")}
          </h3>
          <ul className="divide-y divide-gray-100">
            {entries.slice(0, 5).map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-700">
                      v{entry.version}
                    </span>
                    <span className="truncate text-sm font-medium text-gray-900">
                      {entry.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {new Date(entry.publishedAt).toLocaleDateString(
                      toIntlLocale(locale),
                      {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      },
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        t("changelog.confirmDelete", {
                          version: entry.version,
                        }),
                      )
                    ) {
                      deleteChangelog.mutate({ id: entry.id });
                    }
                  }}
                  disabled={deleteChangelog.isPending}
                  className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  aria-label={t("changelog.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsSection>
  );
}

const DEFAULT_SETTINGS: SettingsState = {
  notification_email: "",
  discord_webhook_url: "",
  notify_signup: "true",
  notify_subscription_started: "true",
  notify_payment_failed: "true",
  notify_subscription_cancelled: "true",
  notify_trial_ending: "true",
  notify_user_flagged: "true",
};

export default function AdminSettingsPage() {
  const t = useTranslations("adminSettings");
  const utils = trpc.useUtils();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);

  const { data: serverSettings } =
    trpc.admin.getNotificationSettings.useQuery();

  // Hydrate local state when server data arrives. Merge so any newly-added
  // keys fall back to the DEFAULT_SETTINGS values.
  useEffect(() => {
    if (serverSettings) {
      setSettings((current) => ({ ...current, ...serverSettings }));
    }
  }, [serverSettings]);

  const updateSettings = trpc.admin.updateNotificationSettings.useMutation({
    onSuccess: () => {
      utils.admin.getNotificationSettings.invalidate();
      toast.success(t("notifications.saved"));
    },
    onError: (err) => toast.error(err.message),
  });

  const testWebhook = trpc.admin.testDiscordWebhook.useMutation({
    onSuccess: () => toast.success(t("notifications.testSent")),
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    updateSettings.mutate({
      settings: {
        notification_email: settings.notification_email,
        discord_webhook_url: settings.discord_webhook_url,
        notify_signup: settings.notify_signup,
        notify_subscription_started: settings.notify_subscription_started,
        notify_payment_failed: settings.notify_payment_failed,
        notify_subscription_cancelled: settings.notify_subscription_cancelled,
        notify_trial_ending: settings.notify_trial_ending,
        notify_user_flagged: settings.notify_user_flagged,
      },
    });
  };

  const handleTestWebhook = () => {
    if (!settings.discord_webhook_url) {
      toast.error(t("notifications.webhookRequired"));
      return;
    }
    testWebhook.mutate({ webhookUrl: settings.discord_webhook_url });
  };

  const saving = updateSettings.isPending;
  const testingWebhook = testWebhook.isPending;
  const isToggleOn = (key: string) => settings[key] !== "false";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t("page.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t("page.subtitle")}</p>
      </div>

      {/* Notifications section */}
      <SettingsSection
        title={t("notifications.title")}
        description={t("notifications.description")}
        icon={Bell}
      >
        <div className="space-y-5">
          {/* Email config */}
          <div>
            <label
              htmlFor="notification-email"
              className="block text-sm font-medium text-gray-700"
            >
              {t("notifications.emailLabel")}
            </label>
            <p className="mb-1.5 text-xs text-gray-500">
              {t("notifications.emailHint")}
            </p>
            <input
              id="notification-email"
              type="text"
              value={settings.notification_email}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  notification_email: e.target.value,
                }))
              }
              placeholder="admin@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Discord webhook config */}
          <div>
            <label
              htmlFor="discord-webhook"
              className="block text-sm font-medium text-gray-700"
            >
              {t("notifications.webhookLabel")}
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="discord-webhook"
                type="url"
                value={settings.discord_webhook_url}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    discord_webhook_url: e.target.value,
                  }))
                }
                placeholder="https://discord.com/api/webhooks/..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={testingWebhook}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <TestTube className="h-3.5 w-3.5" />
                {t("notifications.test")}
              </button>
            </div>
          </div>

          {/* Event toggles */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              {t("notifications.eventTypes")}
            </h3>
            <div className="divide-y divide-gray-50">
              {eventTypes.map((event) => (
                <Toggle
                  key={event.key}
                  checked={isToggleOn(event.key)}
                  onChange={(v) =>
                    setSettings((s) => ({
                      ...s,
                      [event.key]: v ? "true" : "false",
                    }))
                  }
                  label={t(`events.${event.key}.label`)}
                  description={t(`events.${event.key}.description`)}
                />
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? t("notifications.saving") : t("notifications.save")}
            </button>
          </div>
        </div>
      </SettingsSection>

      {/* Support inboxes + signature */}
      <SupportSettingsSection />

      {/* Feature Flags section */}
      <FeatureFlagsSection />

      {/* Per-browser debug tools */}
      <DebugSection />

      {/* Changelog section */}
      <ChangelogSection />
    </div>
  );
}
