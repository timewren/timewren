"use client";

import {
  Bot,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  Mail,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { trpc } from "@/providers/trpc-provider";

const AI_PROVIDER_PRESETS = [
  {
    id: "openai",
    icon: Sparkles,
    baseUrl: "",
    defaultModel: "gpt-4o-mini",
    dbProvider: "openai" as const,
    hasNote: true,
  },
  {
    id: "anthropic",
    icon: Bot,
    baseUrl: "https://api.anthropic.com/v1/",
    defaultModel: "claude-sonnet-4-5-20250929",
    dbProvider: "custom" as const,
    hasNote: true,
  },
  {
    id: "ordbogen",
    icon: Globe,
    baseUrl: "https://api.odincore.ai/v1/",
    // Ordbogen.ai blev til OdinCore.ai; gemte nøgler på det gamle domæne
    // skal stadig genkendes som dette preset.
    legacyBaseUrls: ["https://api.ordbogen.ai/v1/"],
    defaultModel: "odin-2",
    dbProvider: "custom" as const,
    badge: true,
    hasNote: true,
  },
  {
    id: "custom",
    icon: Settings2,
    baseUrl: "",
    defaultModel: "",
    dbProvider: "custom" as const,
  },
];

const AI_AUTONOMY_LEVELS = [
  { value: "manual", icon: Shield },
  { value: "suggest", icon: Sparkles },
  { value: "auto_lowrisk", icon: Zap },
  { value: "auto_all", icon: Bot },
];

const TIMEZONES = [
  "Europe/Copenhagen",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

export default function AISettingsPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const fid = useId();
  const t = useTranslations("settingsAi");
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("openai");
  const [byokForm, setByokForm] = useState({
    provider: "openai" as "system" | "openai" | "custom",
    apiKey: "",
    apiUrl: "",
    model: "",
  });
  const [testingConnection, setTestingConnection] = useState(false);

  // Queries
  const { data: emailSettings, isLoading: emailLoading } =
    trpc.user.getEmailToTaskSettings.useQuery();

  const { data: aiSettings, isLoading: aiLoading } =
    trpc.user.getAISettings.useQuery();

  const { data: aiStats } = trpc.ai.getStats.useQuery();

  // Initialize form when aiSettings data changes
  useEffect(() => {
    if (aiSettings) {
      const savedProvider =
        (aiSettings.aiProvider as "system" | "openai" | "custom") || "openai";
      const savedUrl = aiSettings.aiApiUrl || "";
      const savedModel = aiSettings.aiModel || "";

      // Determine which preset matches saved settings
      let matchedPreset = "custom";
      if (savedProvider === "openai" && !savedUrl) {
        matchedPreset = "openai";
      } else if (savedProvider === "system") {
        // Migrate away from system preset
        matchedPreset = "openai";
      } else if (savedProvider === "custom") {
        // Try matching URL to a known preset
        const urlPreset = AI_PROVIDER_PRESETS.find((p) =>
          [p.baseUrl, ...(p.legacyBaseUrls ?? [])].some(
            (url) => url && savedUrl?.startsWith(url.replace(/\/$/, "")),
          ),
        );
        matchedPreset = urlPreset?.id || "custom";
      }

      setSelectedPreset(matchedPreset);
      setByokForm({
        provider: savedProvider === "system" ? "openai" : savedProvider,
        apiKey: "",
        apiUrl: savedUrl,
        model: savedModel,
      });
    }
  }, [aiSettings]);

  // Test AI connection mutation
  const testConnectionMutation = trpc.user.testAIConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t("connectionOk"), {
          description: result.message,
        });
      } else {
        toast.error(t("connectionFailed"), {
          description: result.message,
        });
      }
      setTestingConnection(false);
    },
    onError: (error) => {
      toast.error(t("testFailed"), {
        description: error.message,
      });
      setTestingConnection(false);
    },
  });

  // Mutations
  const enableEmailMutation = trpc.user.enableEmailToTask.useMutation({
    onSuccess: () => {
      toast.success(t("emailEnabled"));
      utils.user.getEmailToTaskSettings.invalidate();
    },
    onError: (error) => {
      toast.error(t("emailEnableFailed"), {
        description: error.message,
      });
    },
  });

  const disableEmailMutation = trpc.user.disableEmailToTask.useMutation({
    onSuccess: () => {
      toast.success(t("emailDisabled"));
      utils.user.getEmailToTaskSettings.invalidate();
    },
    onError: (error) => {
      toast.error(t("emailDisableFailed"), {
        description: error.message,
      });
    },
  });

  const regenerateEmailMutation = trpc.user.regenerateInboundEmail.useMutation({
    onSuccess: () => {
      toast.success(t("addressRegenerated"));
      utils.user.getEmailToTaskSettings.invalidate();
    },
    onError: (error) => {
      toast.error(t("addressRegenerateFailed"), {
        description: error.message,
      });
    },
  });

  const updateAIMutation = trpc.user.updateAISettings.useMutation({
    onSuccess: () => {
      toast.success(t("settingsUpdated"));
      utils.user.getAISettings.invalidate();
    },
    onError: (error) => {
      toast.error(t("settingsUpdateFailed"), {
        description: error.message,
      });
    },
  });

  const utils = trpc.useUtils();

  const handleCopyEmail = () => {
    if (emailSettings?.inboundEmail) {
      navigator.clipboard.writeText(emailSettings.inboundEmail);
      setCopiedEmail(true);
      toast.success(t("addressCopied"));
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const handleAutonomyChange = (level: string) => {
    updateAIMutation.mutate({
      aiAutonomyLevel: level as
        | "manual"
        | "suggest"
        | "auto_lowrisk"
        | "auto_all",
    });
  };

  const handleTimezoneChange = (timezone: string) => {
    updateAIMutation.mutate({ timezone });
  };

  const handleWorkingHoursChange = (start: string, end: string) => {
    updateAIMutation.mutate({
      workingHoursStart: start || null,
      workingHoursEnd: end || null,
    });
  };

  const handlePresetChange = (presetId: string) => {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPreset(presetId);
    setByokForm((prev) => ({
      ...prev,
      provider: preset.dbProvider,
      apiUrl: preset.baseUrl,
      model: preset.defaultModel,
    }));
  };

  const handleSaveByokSettings = () => {
    if (byokForm.provider === "system") {
      // Switching back to system - clear custom settings
      updateAIMutation.mutate({
        aiProvider: "system",
        aiApiKey: null,
        aiApiUrl: null,
        aiModel: null,
      });
    } else {
      // Validate required fields
      if (!byokForm.apiKey && !aiSettings?.hasCustomApiKey) {
        toast.error(t("keyRequired"));
        return;
      }

      if (
        byokForm.provider === "custom" &&
        selectedPreset === "custom" &&
        !byokForm.apiUrl
      ) {
        toast.error(t("urlRequired"));
        return;
      }

      updateAIMutation.mutate({
        aiProvider: byokForm.provider,
        aiApiKey: byokForm.apiKey || undefined,
        aiApiUrl: byokForm.apiUrl || null,
        aiModel: byokForm.model || null,
      });
    }
  };

  const handleTestConnection = () => {
    if (!byokForm.apiKey && !aiSettings?.hasCustomApiKey) {
      toast.error(t("enterKeyFirst"));
      return;
    }

    setTestingConnection(true);
    testConnectionMutation.mutate({
      provider: byokForm.provider === "openai" ? "openai" : "custom",
      apiKey: byokForm.apiKey || "existing",
      apiUrl: byokForm.apiUrl || undefined,
      model: byokForm.model || undefined,
    });
  };

  if (emailLoading || aiLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <PageHeader title={t("title")} description={t("description")} />

      {/* AI Status Card */}
      {aiStats && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`p-2 rounded-lg ${aiSettings?.aiEnabled ? "bg-green-100 dark:bg-green-900/30" : "bg-gray-100 dark:bg-gray-700"}`}
            >
              <Bot
                className={`h-5 w-5 ${aiSettings?.aiEnabled ? "text-green-600" : "text-gray-500"}`}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("statusTitle")}
              </h2>
              <p
                className={`text-sm ${aiSettings?.aiEnabled ? "text-green-600" : "text-gray-500"}`}
              >
                {aiSettings?.aiEnabled
                  ? t("statusEnabled")
                  : t("statusDisabled")}
              </p>
            </div>
          </div>

          {aiSettings?.aiEnabled && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {aiStats.totalCalls}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("statCalls")}
                </div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {Math.round(aiStats.successRate * 100)}%
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("statSuccess")}
                </div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-brand-600 dark:text-brand-400">
                  {Math.round(aiStats.averageConfidence * 100)}%
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("statConfidence")}
                </div>
              </div>
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {aiStats.averageProcessingTime}ms
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("statTime")}
                </div>
              </div>
            </div>
          )}

          {!aiSettings?.aiEnabled && (
            <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {t("enableHint")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* BYOK - Bring Your Own Key Section */}
      <div
        id="ai-udbyder"
        className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            <Key className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("providerTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("providerSub")}
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("providerIntro", { brand: brand.name })}
        </p>

        {/* Provider Preset Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {AI_PROVIDER_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isSelected = selectedPreset === preset.id;

            return (
              <button
                type="button"
                key={preset.id}
                onClick={() => handlePresetChange(preset.id)}
                className={`
                  flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-all
                  ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }
                `}
              >
                <div className="flex items-center gap-2 w-full">
                  <div
                    className={`p-2 rounded-lg ${isSelected ? "bg-emerald-100 dark:bg-emerald-800" : "bg-gray-100 dark:bg-gray-700"}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${isSelected ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500"}`}
                    />
                  </div>
                  <span
                    className={`font-medium ${isSelected ? "text-emerald-700 dark:text-emerald-300" : "text-gray-900 dark:text-white"}`}
                  >
                    {t(`presets.${preset.id}.label`)}
                  </span>
                  {isSelected && (
                    <Check className="h-4 w-4 text-emerald-600 ml-auto flex-shrink-0" />
                  )}
                </div>
                {"badge" in preset && preset.badge && (
                  <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-300">
                    {"\u{1F1E9}\u{1F1F0}"} {t(`presets.${preset.id}.badge`)}
                  </span>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t(`presets.${preset.id}.description`)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Preset note */}
        {(() => {
          const activePreset = AI_PROVIDER_PRESETS.find(
            (p) => p.id === selectedPreset,
          );
          return activePreset && "hasNote" in activePreset ? (
            <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-600 dark:bg-tt-gran-lys">
              <p className="text-sm text-brand-800 dark:text-brand-200">
                {t(`presets.${activePreset.id}.note`)}
              </p>
            </div>
          ) : null;
        })()}

        {/* Configuration Fields */}
        {selectedPreset !== "system" && (
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            {/* API Key */}
            <div>
              <label
                htmlFor={`${fid}-f1`}
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {t("apiKey")}{" "}
                {aiSettings?.hasCustomApiKey && (
                  <span className="text-green-600">{t("configured")}</span>
                )}
              </label>
              <div className="relative">
                <input
                  id={`${fid}-f1`}
                  type={showApiKey ? "text" : "password"}
                  value={byokForm.apiKey}
                  onChange={(e) =>
                    setByokForm((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                  placeholder={
                    aiSettings?.hasCustomApiKey
                      ? "••••••••••••••••"
                      : selectedPreset === "openai"
                        ? "sk-..."
                        : selectedPreset === "anthropic"
                          ? "sk-ant-..."
                          : t("keyPlaceholder")
                  }
                  className="w-full px-3 py-1.5 pr-10 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {selectedPreset === "openai"
                  ? t("keyHelpOpenai")
                  : selectedPreset === "anthropic"
                    ? t("keyHelpAnthropic")
                    : selectedPreset === "ordbogen"
                      ? t("keyHelpOrdbogen")
                      : t("keyHelpOther")}
              </p>
            </div>

            {/* API URL */}
            <div>
              <label
                htmlFor={`${fid}-f2`}
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {t("apiUrl")}
              </label>
              <input
                id={`${fid}-f2`}
                type="url"
                value={byokForm.apiUrl}
                onChange={(e) =>
                  setByokForm((prev) => ({ ...prev, apiUrl: e.target.value }))
                }
                placeholder={
                  selectedPreset === "openai"
                    ? t("urlPlaceholderOpenai")
                    : selectedPreset === "custom"
                      ? t("urlPlaceholderCustom")
                      : t("urlPlaceholderPreset")
                }
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("urlHelp")}
              </p>
            </div>

            {/* Model */}
            <div>
              <label
                htmlFor={`${fid}-f3`}
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {t("model")}
              </label>
              <input
                id={`${fid}-f3`}
                type="text"
                value={byokForm.model}
                onChange={(e) =>
                  setByokForm((prev) => ({ ...prev, model: e.target.value }))
                }
                placeholder={
                  selectedPreset === "openai"
                    ? t("modelPlaceholderOpenai")
                    : selectedPreset === "anthropic"
                      ? "claude-sonnet-4-5-20250929"
                      : selectedPreset === "ordbogen"
                        ? "odin-2"
                        : t("modelPlaceholderOther")
                }
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("modelHelp")}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 pt-4">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={
                  testingConnection ||
                  (!byokForm.apiKey && !aiSettings?.hasCustomApiKey)
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
              >
                {testingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {t("testConnection")}
              </button>
              <button
                type="button"
                onClick={handleSaveByokSettings}
                disabled={updateAIMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {updateAIMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t("saveSettings")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Help: How to get an API key */}
      {!aiSettings?.aiEnabled && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
              <Key className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("help.title")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("help.sub")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg bg-white dark:bg-gray-900 p-4 border border-brand-100 dark:border-brand-600">
              <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <Globe className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                {t("presets.ordbogen.label")}
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-300">
                  {"\u{1F1E9}\u{1F1F0}"} {t("presets.ordbogen.badge")}
                </span>
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t("help.odinDesc")}
              </p>
              <ol className="mt-2 text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
                <li>{t("help.odin1")}</li>
                <li>{t("help.odin2")}</li>
                <li>{t("help.odin3")}</li>
                <li>{t("help.odin4")}</li>
              </ol>
            </div>

            <div className="rounded-lg bg-white dark:bg-gray-900 p-4 border border-brand-100 dark:border-brand-600">
              <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-green-600" />
                OpenAI
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t("help.openaiDesc")}
              </p>
              <ol className="mt-2 text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
                <li>{t("help.openai1")}</li>
                <li>{t("help.openai2")}</li>
                <li>{t("help.openai3")}</li>
                <li>{t("help.copyPaste")}</li>
              </ol>
            </div>

            <div className="rounded-lg bg-white dark:bg-gray-900 p-4 border border-brand-100 dark:border-brand-600">
              <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <Bot className="h-4 w-4 text-orange-600" />
                Anthropic
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t("help.anthropicDesc")}
              </p>
              <ol className="mt-2 text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
                <li>{t("help.anthropic1")}</li>
                <li>{t("help.anthropic2")}</li>
                <li>{t("help.anthropic3")}</li>
                <li>{t("help.copyPaste")}</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Email-to-Task Section */}
      <div
        id="email-til-opgave"
        className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
            <Mail className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("email.title")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("email.sub")}
            </p>
          </div>
        </div>

        {emailSettings?.enabled ? (
          <div className="space-y-4">
            {/* Inbound email address */}
            <div>
              <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t("email.address")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <code className="flex-1 text-sm font-mono text-gray-900 dark:text-white">
                    {emailSettings.inboundEmail}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  title={t("email.copyTitle")}
                >
                  {copiedEmail ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-500" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t("email.addressHelp")}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => regenerateEmailMutation.mutate()}
                disabled={regenerateEmailMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {regenerateEmailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t("email.regenerate")}
              </button>
              <button
                type="button"
                onClick={() => disableEmailMutation.mutate()}
                disabled={disableEmailMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-transparent border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {disableEmailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("email.disable")}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <Mail className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              {t("email.notEnabled")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
              {t("email.notEnabledText")}
            </p>
            <button
              type="button"
              onClick={() => enableEmailMutation.mutate()}
              disabled={enableEmailMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors disabled:opacity-50"
            >
              {enableEmailMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("email.enable")}
            </button>
          </div>
        )}
      </div>

      {/* AI Autonomy Level */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
            <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("autonomyTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("autonomySub")}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {AI_AUTONOMY_LEVELS.map((level) => {
            const Icon = level.icon;
            const isSelected = aiSettings?.aiAutonomyLevel === level.value;

            return (
              <button
                type="button"
                key={level.value}
                onClick={() => handleAutonomyChange(level.value)}
                disabled={updateAIMutation.isPending}
                className={`
                  flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all
                  ${
                    isSelected
                      ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }
                  disabled:opacity-50
                `}
              >
                <div
                  className={`p-2 rounded-lg ${isSelected ? "bg-brand-100 dark:bg-tt-gran-lys" : "bg-gray-100 dark:bg-gray-700"}`}
                >
                  <Icon
                    className={`h-4 w-4 ${isSelected ? "text-brand-600 dark:text-brand-400" : "text-gray-500"}`}
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${isSelected ? "text-brand-700 dark:text-brand-300" : "text-gray-900 dark:text-white"}`}
                    >
                      {t(`autonomy.${level.value}.label`)}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t(`autonomy.${level.value}.description`)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Working Hours & Timezone */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("hoursTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("hoursSub")}
            </p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Timezone */}
          <div>
            <label
              htmlFor={`${fid}-f4`}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              <Globe className="inline h-4 w-4 mr-1" />
              {t("timezone")}
            </label>
            <select
              id={`${fid}-f4`}
              value={aiSettings?.timezone || "Europe/Copenhagen"}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {t(`timezones.${tz}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Working hours */}
          <div>
            <label
              htmlFor={`${fid}-f5`}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              <Clock className="inline h-4 w-4 mr-1" />
              {t("workingHours")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${fid}-f5`}
                type="time"
                value={aiSettings?.workingHoursStart || "09:00"}
                onChange={(e) =>
                  handleWorkingHoursChange(
                    e.target.value,
                    aiSettings?.workingHoursEnd || "17:00",
                  )
                }
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
              />
              <span className="text-gray-500">{t("to")}</span>
              <input
                type="time"
                value={aiSettings?.workingHoursEnd || "17:00"}
                onChange={(e) =>
                  handleWorkingHoursChange(
                    aiSettings?.workingHoursStart || "09:00",
                    e.target.value,
                  )
                }
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t("hoursHelp")}
            </p>
          </div>
        </div>
      </div>

      {/* Privacy note */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50 p-4">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              {t("privacyTitle")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("privacyText")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
