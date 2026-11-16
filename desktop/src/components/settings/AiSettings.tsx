import {
  CheckCircle,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { getOfflineMessage, isNetworkError } from "@/hooks/useNetworkStatus";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { tauriInvoke } from "@/lib/tauri";
import { toast } from "@/stores/toastStore";
import {
  type ClassificationRule,
  CONDITION_OP_KEYS,
  CONDITION_TYPE_KEYS,
  RuleDialog,
} from "./RuleDialog";

interface AiConfig {
  provider: string;
  api_key: string | null;
  model: string | null;
  base_url: string | null;
}

/**
 * En udbyder er enten et **produktnavn** (`OpenAI`, `Ordbogen.ai`) eller et navn
 * med et ord i sætningen ved siden af (`Ollama (lokal)`). Kun det sidste er
 * tekst, der skal oversættes, så det kommer fra en nøgle; produktnavne står i
 * koden, fordi «Ollama» hedder «Ollama» på alle fem sprog.
 */
interface Provider {
  value: string;
  label?: string;
  labelKey?: string;
  needsKey: boolean;
  speed: "speedFastest" | "speedFast" | "speedMedium" | "speedLocal";
}

const PROVIDERS: Provider[] = [
  {
    value: "openai",
    label: "OpenAI",
    needsKey: true,
    speed: "speedFastest",
  },
  {
    value: "anthropic",
    label: "Claude (Anthropic)",
    needsKey: true,
    speed: "speedFast",
  },
  {
    value: "google",
    label: "Google Gemini",
    needsKey: true,
    speed: "speedFastest",
  },
  {
    value: "ollama",
    labelKey: "ai.providerOllama",
    needsKey: false,
    speed: "speedLocal",
  },
  {
    value: "ordbogen",
    label: "Ordbogen.ai",
    needsKey: true,
    speed: "speedMedium",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    speed: "speedFast",
  },
];

const SPEED_COLORS: Record<string, string> = {
  speedFastest: "text-emerald-400",
  speedFast: "text-sky-400",
  speedMedium: "text-amber-400",
  speedLocal: "text-violet-400",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.0-flash",
  ollama: "llama3.1:8b",
  ordbogen: "odin",
  openrouter: "anthropic/claude-haiku-4-5-20251001",
};

export function AiSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfig>({
    provider: "openai",
    api_key: null,
    model: null,
    base_url: null,
  });
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");
  // `isError` er ikke kosmetik: feltet males i grønt, så uden denne markering viste
  // "Kunne ikke gemme" og "Kunne ikke slette" sig som en succes i emerald.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);
  const [editingRule, setEditingRule] = useState<ClassificationRule | null>(
    null,
  );
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const aiConfig = await tauriInvoke<AiConfig>("get_ai_config");
      setConfig(aiConfig);
    } catch {
      // use defaults
    }
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const data = await tauriInvoke<ClassificationRule[]>("list_rules");
      setRules(data);
    } catch {
      // no rules yet
    }
  }, []);

  // Projekterne bruges kun i regel-dialogen, så de hentes først når den åbner —
  // og de kommer gennem hooken, så en fejlvisning hører sammen med dem. Før lå
  // de i `loadProjects` med `catch { /* no projects yet */ }`, altså en
  // dropdown uden valg der så ud som om brugeren ingen projekter havde.
  const { projects, loadFailed, retry } = useProjectClientPicker({
    active: ruleDialogOpen,
    clients: false,
  });

  useEffect(() => {
    loadConfig();
    loadRules();
  }, [loadConfig, loadRules]);

  const saveConfig = useCallback(
    async (newConfig: AiConfig) => {
      try {
        await tauriInvoke("set_ai_config", { config: newConfig });
        setSaveStatus({ text: t("common.saved"), isError: false });
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus({ text: t("tracking.saveFailed"), isError: true });
        setTimeout(() => setSaveStatus(null), 3000);
      }
    },
    [t],
  );

  function updateConfig(partial: Partial<AiConfig>) {
    const updated = { ...config, ...partial };
    setConfig(updated);
    saveConfig(updated);
  }

  async function handleTestConnection() {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const result = await tauriInvoke<string>("test_ai_connection", {
        config,
      });
      setTestStatus("success");
      setTestMessage(result);
    } catch (err) {
      setTestStatus("error");
      // Uden internet gav dette "OpenAI forbindelsesfejl: error sending
      // request for url (...)" — hele kæden af reqwest-årsager. Brugeren
      // kan handle på "prøv igen senere", ikke på en DNS-fejl.
      setTestMessage(
        isNetworkError(err) ? getOfflineMessage("ai") : String(err),
      );
    }
  }

  function openCreateRule() {
    setEditingRule(null);
    setRuleDialogOpen(true);
  }

  function openEditRule(rule: ClassificationRule) {
    setEditingRule(rule);
    setRuleDialogOpen(true);
  }

  async function handleDeleteRule(id: number) {
    try {
      await tauriInvoke("delete_rule", { id: id as unknown as number });
      toast.success(t("ai.ruleDeleted"));
      loadRules();
    } catch (err) {
      console.error("Failed to delete rule:", err);
      toast.error(t("ai.couldNotDeleteRule"));
    }
  }

  const selectedProvider = PROVIDERS.find((p) => p.value === config.provider);
  const showApiKey = selectedProvider?.needsKey ?? true;
  const showBaseUrl =
    config.provider === "ollama" || config.provider === "ordbogen";

  /**
   * Navnet en udbyder vises under. `labelKey` er den oversatte del, så en
   * dansk «(lokal)» ikke står i listen for en tysk bruger; produktnavne står
   * i koden og hedder det samme overalt. `value` er sidste udvej, så en
   * udbyder der ikke står i listen (ældre konfiguration) stadig viser sig.
   */
  const udbyderLabel = (p: Provider): string =>
    p.labelKey ? t(p.labelKey) : (p.label ?? p.value);

  return (
    <div className="space-y-8">
      {saveStatus && (
        <div
          className={`fixed right-6 top-16 z-50 rounded-md bg-(--color-surface) border border-(--color-border) px-3 py-1.5 text-xs font-medium shadow-lg ${saveStatus.isError ? "text-red-400" : "text-emerald-400"}`}
        >
          {saveStatus.text}
        </div>
      )}

      {/* Provider */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("ai.providerTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("ai.providerDescription")}
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label={t("ai.selectProvider")}
            onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
            className="flex h-9 w-full max-w-xs items-center justify-between rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm transition-colors hover:border-(--color-text-muted)"
          >
            <span className="flex items-center gap-2 text-(--color-text)">
              {selectedProvider
                ? udbyderLabel(selectedProvider)
                : config.provider}
              {selectedProvider && (
                <span
                  className={`text-[10px] font-medium ${SPEED_COLORS[selectedProvider.speed] ?? ""}`}
                >
                  {t(`ai.${selectedProvider.speed}`)}
                </span>
              )}
            </span>
            <ChevronDown
              size={14}
              className={`text-(--color-text-muted) transition-transform ${providerDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {providerDropdownOpen && (
            <div className="absolute top-full z-20 mt-1 w-full max-w-xs overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
              {PROVIDERS.map((p) => (
                <button
                  type="button"
                  key={p.value}
                  onClick={() => {
                    const baseUrlDefaults: Record<string, string> = {
                      ollama: "http://localhost:11434",
                      ordbogen: "https://api.ordbogen.ai/v1",
                    };
                    updateConfig({
                      provider: p.value,
                      model: DEFAULT_MODELS[p.value] ?? null,
                      base_url: baseUrlDefaults[p.value] ?? null,
                    });
                    setProviderDropdownOpen(false);
                    setTestStatus("idle");
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border) ${
                    config.provider === p.value ? "bg-(--color-border)" : ""
                  }`}
                >
                  <span className="text-(--color-text)">{udbyderLabel(p)}</span>
                  <span
                    className={`text-[10px] font-medium ${SPEED_COLORS[p.speed] ?? ""}`}
                  >
                    {t(`ai.${p.speed}`)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* API Key */}
      {showApiKey && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("ai.apiKeyTitle")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("ai.apiKeyDescription")}
            </p>
          </div>
          <Input
            type="password"
            value={config.api_key ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                api_key: e.target.value || null,
              }))
            }
            onBlur={() => saveConfig(config)}
            placeholder={t("ai.apiKeyPlaceholder")}
            aria-label={t("ai.apiKeyTitle")}
            className="max-w-md"
          />
        </section>
      )}

      {/* Model */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("ai.modelTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("ai.modelDefault", {
              model: DEFAULT_MODELS[config.provider] ?? t("ai.modelUnknown"),
            })}
          </p>
        </div>
        <Input
          value={config.model ?? ""}
          onChange={(e) =>
            setConfig((prev) => ({ ...prev, model: e.target.value || null }))
          }
          onBlur={() => saveConfig(config)}
          placeholder={DEFAULT_MODELS[config.provider] ?? "model-name"}
          aria-label={t("ai.modelTitle")}
          className="max-w-md"
        />
      </section>

      {/* Base URL (Ollama / Ordbogen.ai) */}
      {showBaseUrl && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {config.provider === "ollama"
                ? t("ai.ollamaUrl")
                : t("ai.baseUrl")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {config.provider === "ollama"
                ? t("ai.ollamaUrlDescription")
                : t("ai.baseUrlDescription")}
            </p>
          </div>
          <Input
            value={config.base_url ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                base_url: e.target.value || null,
              }))
            }
            onBlur={() => saveConfig(config)}
            placeholder={
              config.provider === "ollama"
                ? "http://localhost:11434"
                : "https://api.ordbogen.ai/v1"
            }
            aria-label={
              config.provider === "ollama" ? t("ai.ollamaUrl") : t("ai.baseUrl")
            }
            className="max-w-md"
          />
        </section>
      )}

      {/* OpenRouter info note */}
      {config.provider === "openrouter" && (
        <section>
          <p className="text-xs text-(--color-text-muted) rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 max-w-md">
            {t("ai.openRouterInfo")}
          </p>
        </section>
      )}

      {/* Test connection */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestConnection}
            disabled={testStatus === "testing"}
          >
            {testStatus === "testing" && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {testStatus === "success" && (
              <CheckCircle size={14} className="text-emerald-400" />
            )}
            {testStatus === "error" && (
              <XCircle size={14} className="text-red-400" />
            )}
            {t("ai.testConnection")}
          </Button>
          {testMessage && (
            <span
              className={`text-xs ${testStatus === "success" ? "text-emerald-400" : "text-red-400"}`}
            >
              {testMessage}
            </span>
          )}
        </div>
      </section>

      {/* Classification rules */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("ai.rulesTitle")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("ai.rulesDescription")}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={openCreateRule}>
            <Plus size={14} />
            {t("ai.addRule")}
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center">
            <p className="text-sm text-(--color-text-muted)">
              {t("ai.noRules")}
            </p>
            <p className="mt-1 text-xs text-(--color-text-muted)">
              {t("ai.noRulesDescription")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 ${
                  !rule.is_active ? "opacity-50" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-(--color-text)">
                    {rule.name}
                  </p>
                  <p className="text-xs text-(--color-text-muted)">
                    {t("ai.ruleCondition", {
                      type: t(
                        CONDITION_TYPE_KEYS[rule.condition_type] ??
                          rule.condition_type,
                      ),
                      op: t(
                        CONDITION_OP_KEYS[rule.condition_op] ??
                          rule.condition_op,
                      ),
                      value: rule.condition_value,
                    })}
                    {rule.target_category && ` → ${rule.target_category}`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`${t("ai.editRule")}: ${rule.name}`}
                  onClick={() => openEditRule(rule)}
                  className="rounded-md p-1.5 text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`${t("common.delete")}: ${rule.name}`}
                  onClick={() => setDeleteRuleId(rule.id)}
                  className="rounded-md p-1.5 text-(--color-text-muted) transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rule create/edit dialog */}
      <RuleDialog
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        onSaved={() => {
          setRuleDialogOpen(false);
          loadRules();
        }}
        projects={projects}
        projectsLoadFailed={loadFailed}
        onRetryProjects={retry}
        editingRule={editingRule}
      />

      {/* Delete rule confirmation dialog */}
      <Dialog
        open={deleteRuleId !== null}
        onClose={() => setDeleteRuleId(null)}
        title={t("ai.deleteRuleConfirmTitle")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteRuleId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (deleteRuleId !== null) handleDeleteRule(deleteRuleId);
                setDeleteRuleId(null);
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-(--color-text-muted)">
          {t("ai.deleteRuleConfirmText")}
        </p>
      </Dialog>
    </div>
  );
}
