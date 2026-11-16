import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  ExternalLink,
  Gift,
  Key,
  Link2,
  Loader2,
  Rocket,
  Shield,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";
import type { Client, Project } from "@/lib/types";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSyncStore } from "@/stores/syncStore";
import { WizardStep } from "./WizardStep";

interface OnboardingWizardProps {
  onComplete: () => void;
}

interface LicenseProof {
  license_key: string;
  tier: string;
  valid_until: string | null;
  devices_allowed: number;
  issued_at: string;
  verified_at: string;
}

interface TrialStatus {
  is_active: boolean;
  days_remaining: number;
  started_at: string | null;
}

// AI provider options (matches AiSettings). `labelKey` bruges kun hvor navnet
// rummer dansk — `(lokal)` — så resten kan blive stående som produktnavne.
const AI_PROVIDERS: {
  value: string;
  label?: string;
  labelKey?: string;
  placeholder: string;
}[] = [
  { value: "openai", label: "OpenAI", placeholder: "sk-..." },
  {
    value: "anthropic",
    label: "Claude (Anthropic)",
    placeholder: "sk-ant-...",
  },
  { value: "google", label: "Google Gemini", placeholder: "AI..." },
  {
    value: "ollama",
    labelKey: "ai.providerOllama",
    placeholder: "",
  },
  { value: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];

const PROJECT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#6366f1",
  "#a855f7",
];

/**
 * En besked i selve wizarden. `warning` er en tilstand wizarden kan fortsætte
 * fra (tjekket mislykkedes), `error` er en handling der ikke gennemførtes — den
 * skal læses højt, fordi brugeren ellers går videre og tror det lykkedes.
 */
function WizardMessage({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "error";
}) {
  const ramme =
    tone === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-400"
      : "border-amber-500/30 bg-amber-500/10 text-(--color-text-muted)";
  return (
    <p
      role="alert"
      className={`mt-2 rounded-md border px-2 py-1.5 text-xs ${ramme}`}
    >
      {children}
    </p>
  );
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  // Step 1 (license) state — moved before cloud
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseActivating, setLicenseActivating] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [licenseActivated, setLicenseActivated] = useState(false);
  const [trialStarted, setTrialStarted] = useState(false);
  const [trialFailed, setTrialFailed] = useState(false);
  const [syncConnected, setSyncConnected] = useState(false); // cloud login from license step

  // Step 2 (cloud sync) state
  const syncStore = useSyncStore();

  // Step 3: Client form
  const [clientName, setClientName] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [createdClient, setCreatedClient] = useState<Client | null>(null);
  const [existingClientsCount, setExistingClientsCount] = useState<
    number | null
  >(null);
  const [clientAutoSkipped, setClientAutoSkipped] = useState(false);
  const [clientCheckFailed, setClientCheckFailed] = useState(false);
  const [clientSaveFailed, setClientSaveFailed] = useState(false);

  // Step 4: Project form
  const [projectName, setProjectName] = useState("");
  const [projectRate, setProjectRate] = useState("");
  const [projectColor, setProjectColor] = useState(PROJECT_COLORS[0]);
  const [existingProjectsCount, setExistingProjectsCount] = useState<
    number | null
  >(null);
  const [projectAutoSkipped, setProjectAutoSkipped] = useState(false);
  const [projectCheckFailed, setProjectCheckFailed] = useState(false);
  const [projectSaveFailed, setProjectSaveFailed] = useState(false);

  // Step 5: AI config
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiSaveFailed, setAiSaveFailed] = useState(false);

  // Privacy consent (step 0)
  const setSentryEnabled = useSettingsStore((s) => s.setSentryEnabled);
  const setAnalyticsEnabled = useSettingsStore((s) => s.setAnalyticsEnabled);
  const [consentSentry, setConsentSentry] = useState(true);
  const [consentAnalytics, setConsentAnalytics] = useState(true);

  // Navigation state
  const [saving, setSaving] = useState(false);

  const totalSteps = 7;
  // Fixed step list — position is the identity of a bar, so map over plain
  // numbers instead of the map index.
  const stepBars = Array.from({ length: totalSteps }, (_, i) => i);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => {
      // Persist privacy consent when leaving step 0
      if (s === 0) {
        setSentryEnabled(consentSentry);
        setAnalyticsEnabled(consentAnalytics);
        // Samtykket skal også ligge i databasen. Det gør det i standen, som er
        // den ene kilde: `initSentry` læser `sentryEnabled` fra den, og Rust
        // får beskeden gennem `set_error_reporting`. `sentry_enabled` og
        // `analytics_enabled` som rå settings-rækker blev skrevet her, men
        // læses ingen steder — de var to døde skrivninger.
      }
      const next = Math.min(s + 1, totalSteps - 1);
      // Skip cloud step if already connected from license step
      if (next === 2 && syncConnected) {
        return Math.min(next + 1, totalSteps - 1);
      }
      return next;
    });
  }, [
    syncConnected,
    consentSentry,
    consentAnalytics,
    setSentryEnabled,
    setAnalyticsEnabled,
  ]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Auto-skip client step if cloud data already has clients
  //
  // Denne tjek *skal* fejle stille: brugeren skal kunne oprette sin første kunde,
  // uanset hvad databasen svarer. Men stilhed er ikke det samme som ligegyld —
  // brugeren får «opret din første kunde» og opretter en kunde, han måske
  // allerede har. Derfor står der en linje om at tjekket mislykkedes, og derfor
  // *ikke* en fejlskærm der blokerer selve oprettelsen.
  useEffect(() => {
    if (step !== 3 || clientAutoSkipped) return;
    tauriInvoke<Client[]>("list_clients", { includeArchived: false })
      .then((clients) => {
        if (clients.length > 0) {
          setExistingClientsCount(clients.length);
          setClientAutoSkipped(true);
          const timer = setTimeout(() => {
            goNext();
          }, 1500);
          return () => clearTimeout(timer);
        }
      })
      .catch((err) => {
        console.error("Failed to check for existing clients:", err);
        setClientCheckFailed(true);
      });
  }, [step, clientAutoSkipped, goNext]);

  // Auto-skip project step if cloud data already has projects
  useEffect(() => {
    if (step !== 4 || projectAutoSkipped) return;
    tauriInvoke<Project[]>("list_projects", { includeArchived: false })
      .then((projects) => {
        if (projects.length > 0) {
          setExistingProjectsCount(projects.length);
          setProjectAutoSkipped(true);
          const timer = setTimeout(() => {
            goNext();
          }, 1500);
          return () => clearTimeout(timer);
        }
      })
      .catch((err) => {
        console.error("Failed to check for existing projects:", err);
        setProjectCheckFailed(true);
      });
  }, [step, projectAutoSkipped, goNext]);

  // Handle cloud connect from license step
  const handleCloudConnect = useCallback(async () => {
    // Use syncStore.connect() which opens browser for OAuth
    await syncStore.connect();
  }, [syncStore]);

  // Watch for sync store login completing (from cloud connect on license step)
  useEffect(() => {
    if (syncStore.isLoggedIn && step === 1 && !syncConnected) {
      setSyncConnected(true);
      setLicenseActivated(true); // Cloud subscription = license included
    }
  }, [syncStore.isLoggedIn, step, syncConnected]);

  const handleCreateClient = useCallback(async () => {
    if (!clientName.trim()) {
      goNext();
      return;
    }

    setSaving(true);
    setClientSaveFailed(false);
    try {
      const client = await tauriInvoke<Client>("create_client", {
        input: {
          name: clientName.trim(),
          company: clientCompany.trim() || null,
        },
      });
      setCreatedClient(client);
      goNext();
    } catch (err) {
      // Kunden blev *ikke* oprettet. At gå videre her sagde til brugeren, at vi
      // havde oprettet hende — og gjort det stilt, så han aldrig så det. Han
      // bliver stående på trinnet og kan prøve igen eller springe over.
      console.error("Failed to create client:", err);
      setClientSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }, [clientName, clientCompany, goNext]);

  const handleCreateProject = useCallback(async () => {
    if (!projectName.trim()) {
      goNext();
      return;
    }

    setSaving(true);
    setProjectSaveFailed(false);
    try {
      await tauriInvoke<Project>("create_project", {
        input: {
          name: projectName.trim(),
          client_id: createdClient?.id ?? null,
          hourly_rate: projectRate ? Number.parseFloat(projectRate) : null,
          color: projectColor,
        },
      });
      goNext();
    } catch (err) {
      console.error("Failed to create project:", err);
      setProjectSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }, [projectName, createdClient, projectRate, projectColor, goNext]);

  const handleSaveAiConfig = useCallback(async () => {
    if (!aiApiKey.trim()) {
      goNext();
      return;
    }

    setSaving(true);
    setAiSaveFailed(false);
    try {
      await tauriInvoke("set_ai_config", {
        config: {
          provider: aiProvider,
          api_key: aiApiKey.trim(),
          model: null,
          base_url: null,
        },
      });
      goNext();
    } catch (err) {
      // Nøglen er BYOK, så en tabt nøgle er den eneste kopi brugeren har. At
      // gå videre sagde, at den var gemt — og den var den ikke.
      console.error("Failed to save AI config:", err);
      setAiSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }, [aiProvider, aiApiKey, goNext]);

  const handleActivateLicense = useCallback(async () => {
    const key = licenseKey.trim();
    if (!key) return;

    setLicenseActivating(true);
    setLicenseError(null);

    try {
      await tauriInvoke<LicenseProof>("activate_license", {
        licenseKey: key,
      });
      setLicenseActivated(true);
    } catch (err) {
      setLicenseError(
        typeof err === "string" ? err : t("licenseGate.activationFailed"),
      );
    } finally {
      setLicenseActivating(false);
    }
  }, [licenseKey, t]);

  const handleStartTrial = useCallback(async () => {
    setSaving(true);
    setTrialFailed(false);
    try {
      await tauriInvoke<TrialStatus>("start_trial");
      setTrialStarted(true);
    } catch (err) {
      // Uden prøveperiode står der ingen «Næste» på licenstrinnet, så en
      // stilt fejlet `start_trial` efterlod brugeren fast uden forklaring.
      console.error("Failed to start trial:", err);
      setTrialFailed(true);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleFinish = useCallback(async () => {
    setSaving(true);
    try {
      await tauriInvoke("set_setting", {
        key: "onboarding_completed",
        value: "true",
      });
      onComplete();
    } catch {
      // Force complete even if save fails
      onComplete();
    } finally {
      setSaving(false);
    }
  }, [onComplete]);

  const hasLicenseOrTrial = licenseActivated || trialStarted;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-(--color-bg)"
    >
      <div className="w-full max-w-lg px-6">
        {/* Progress bar */}
        <div className="mb-8 flex items-center gap-2">
          {stepBars.map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-(--color-accent)" : "bg-(--color-border)"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="relative min-h-[340px] overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            {/* Step 0: Welcome */}
            {step === 0 && (
              <WizardStep key="welcome" direction={direction}>
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-accent)">
                    <Clock size={32} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-bold text-(--color-text)">
                    {t("onboarding.welcome")}
                  </h1>
                  <p className="mt-3 max-w-sm text-sm text-(--color-text-muted)">
                    {t("onboarding.welcomeSubtitle")}
                  </p>

                  {/* Privacy info */}
                  <div className="mt-6 w-full max-w-sm rounded-lg border border-(--color-border) bg-(--color-surface) p-4 text-left">
                    <div className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
                      <Shield size={16} className="text-emerald-400" />
                      {t("privacy.privacyTitle")}
                    </div>
                    <ul className="mt-3 space-y-1.5 text-xs text-(--color-text-muted)">
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-emerald-400">
                          •
                        </span>
                        {t("privacy.bullet1")}
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-emerald-400">
                          •
                        </span>
                        {t("privacy.bullet2")}
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-emerald-400">
                          •
                        </span>
                        {t("privacy.bullet3")}
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-emerald-400">
                          •
                        </span>
                        {t("privacy.bullet4")}
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-emerald-400">
                          •
                        </span>
                        {t("privacy.bullet5")}
                      </li>
                    </ul>
                  </div>

                  {/* Consent checkboxes */}
                  <div className="mt-3 w-full max-w-sm rounded-lg border border-(--color-border) bg-(--color-surface) p-4 text-left">
                    <p className="text-sm font-semibold text-(--color-text)">
                      {t("privacy.helpImprove")}
                    </p>

                    <label className="mt-3 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentSentry}
                        onChange={(e) => setConsentSentry(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-(--color-border) accent-(--color-accent)"
                      />
                      <div>
                        <span className="text-xs font-medium text-(--color-text)">
                          {t("privacy.sentryLabel")}
                        </span>
                        <p className="mt-0.5 text-xs text-(--color-text-muted)">
                          {t("privacy.sentryDesc")}
                        </p>
                      </div>
                    </label>

                    <label className="mt-3 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentAnalytics}
                        onChange={(e) => setConsentAnalytics(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-2 border-(--color-border) accent-(--color-accent)"
                      />
                      <div>
                        <span className="text-xs font-medium text-(--color-text)">
                          {t("privacy.analyticsLabel")}
                        </span>
                        <p className="mt-0.5 text-xs text-(--color-text-muted)">
                          {t("privacy.analyticsDesc")}
                        </p>
                      </div>
                    </label>

                    <p className="mt-3 text-xs text-(--color-text-muted)">
                      {t("privacy.canChange")}
                    </p>
                  </div>
                </div>
              </WizardStep>
            )}

            {/* Step 1: License activation — 3 options */}
            {step === 1 && (
              <WizardStep key="license" direction={direction}>
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500">
                    <Key size={32} className="text-white" />
                  </div>
                  <h2 className="text-lg font-bold text-(--color-text)">
                    {t("onboarding.licenseTitle")}
                  </h2>
                  <p className="mt-2 max-w-sm text-sm text-(--color-text-muted)">
                    {t("onboarding.licenseDesc")}
                  </p>

                  {hasLicenseOrTrial ? (
                    <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <CheckCircle2 size={24} className="text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-400">
                        {licenseActivated
                          ? syncConnected
                            ? t("onboarding.subscriptionActive")
                            : t("onboarding.licenseActivated")
                          : t("onboarding.licenseTrialStarted")}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-6 w-full max-w-sm space-y-3">
                      {/* Option 1: Cloud account */}
                      <div className="rounded-lg border border-(--color-border) p-4 text-left">
                        <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                          <Cloud size={16} className="text-blue-400" />
                          {t("onboarding.licenseCloud")}
                        </div>
                        <p className="mt-1 text-xs text-(--color-text-muted)">
                          {t("onboarding.licenseCloudDesc")}
                        </p>
                        <Button
                          size="sm"
                          onClick={handleCloudConnect}
                          disabled={syncStore.isConnecting}
                          className="mt-3 w-full"
                        >
                          {syncStore.isConnecting ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              {t("onboarding.cloudWaiting")}
                            </>
                          ) : (
                            <>
                              <Cloud size={14} />
                              {t("onboarding.cloudConnect")}
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Option 2: License key */}
                      <div className="rounded-lg border border-(--color-border) p-4 text-left">
                        <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                          <Key size={16} className="text-amber-400" />
                          {t("onboarding.licenseKey")}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Input
                            value={licenseKey}
                            onChange={(e) => {
                              setLicenseKey(e.target.value);
                              setLicenseError(null);
                            }}
                            placeholder={t("onboarding.licenseKeyPlaceholder")}
                            aria-label={t("license.enterKey")}
                            className="flex-1 font-mono text-sm"
                          />
                          <Button
                            size="md"
                            onClick={handleActivateLicense}
                            disabled={licenseActivating || !licenseKey.trim()}
                          >
                            {licenseActivating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              t("onboarding.licenseActivate")
                            )}
                          </Button>
                        </div>
                        {licenseError && (
                          <p className="mt-2 text-xs text-red-400">
                            {licenseError}
                          </p>
                        )}
                      </div>

                      {/* Option 3: Trial + lifetime upsell */}
                      <div className="rounded-lg border border-(--color-border) p-4 text-left">
                        <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                          <Gift size={16} className="text-emerald-400" />
                          {t("onboarding.licenseTrial")}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleStartTrial}
                          disabled={saving}
                          className="mt-3 w-full"
                        >
                          {t("onboarding.licenseStartTrial")}
                        </Button>
                        {trialFailed && (
                          <WizardMessage tone="error">
                            {t("license.activateFailed")}
                          </WizardMessage>
                        )}

                        <div className="mt-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-(--color-border)" />
                          <span className="text-xs text-(--color-text-muted)">
                            {t("common.or")}
                          </span>
                          <div className="h-px flex-1 bg-(--color-border)" />
                        </div>

                        <p className="mt-3 text-xs text-(--color-text-muted)">
                          {t("onboarding.licenseBuyLifetime")}
                        </p>
                        <p className="text-xs text-(--color-text-muted)">
                          {t("onboarding.licenseBuyLifetimeDesc")}
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            window.open(
                              "https://timetrack.dk/desktop",
                              "_blank",
                            )
                          }
                          className="mt-2 w-full"
                        >
                          <ExternalLink size={14} />
                          {t("onboarding.licenseBuyNow")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </WizardStep>
            )}

            {/* Step 2: Cloud Sync */}
            {step === 2 && (
              <WizardStep key="cloud" direction={direction}>
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500">
                    <Cloud size={32} className="text-white" />
                  </div>
                  <h2 className="text-lg font-bold text-(--color-text)">
                    {t("onboarding.cloudTitle")}
                  </h2>
                  <p className="mt-2 max-w-sm text-sm text-(--color-text-muted)">
                    {licenseActivated
                      ? t("onboarding.cloudDescLicensed")
                      : t("onboarding.cloudDescTrial")}
                  </p>

                  {/* Desktop license reminder */}
                  <div className="mt-4 w-full max-w-sm rounded-lg border border-(--color-border) bg-(--color-surface) p-3 text-left">
                    <div className="flex items-start gap-2">
                      <Check
                        size={14}
                        className="mt-0.5 shrink-0 text-emerald-400"
                      />
                      <p className="text-sm text-(--color-text)">
                        {t("onboarding.desktopIncluded")}
                      </p>
                    </div>
                  </div>

                  {/* Cloud upsell */}
                  <div className="mt-3 w-full max-w-sm rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-left">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-400">
                      {t("onboarding.cloudUpgrade")}
                    </p>
                    <ul className="space-y-2 text-sm text-(--color-text)">
                      <li className="flex items-center gap-2">
                        <Check size={14} className="shrink-0 text-blue-400" />
                        {t("onboarding.cloudFeature1")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={14} className="shrink-0 text-blue-400" />
                        {t("onboarding.cloudFeature2")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={14} className="shrink-0 text-blue-400" />
                        {t("onboarding.cloudFeature3")}
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={14} className="shrink-0 text-blue-400" />
                        {t("onboarding.cloudFeature4")}
                      </li>
                    </ul>
                    {/* ABONNEMENTSPRISEN STÅR IKKE I TEKSTEN. Den lå her som
                        99 kr/md i alle fem sprog, og 99 er en *gammel*
                        listepris: webbens prisbog bruger den kun til legacy-
                        og founding-planer, mens de planer der sælges i dag er
                        29 og 79 kr/md. Prisen er Mads' at ændre, så i stedet
                        for at gætte står der ingen tal — linket nedenunder
                        sender brugeren videre til prissiden, som appen allerede
                        linker til fra tre andre steder. Ét sted at rette næste
                        gang prisstigen kommer. */}
                    <p className="mt-3 border-t border-blue-500/20 pt-3 text-xs text-(--color-text-muted)">
                      {t("onboarding.cloudFree")}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        window.open("https://timetrack.dk/pricing", "_blank")
                      }
                      className="mt-1 inline-flex items-center gap-1 text-xs text-(--color-text-muted) underline underline-offset-2 transition-colors hover:text-(--color-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      <ExternalLink size={12} />
                      {t("license.seePricing")}
                    </button>
                  </div>

                  <div className="mt-4 w-full max-w-xs space-y-4">
                    {syncStore.isLoggedIn ? (
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                        <CheckCircle2 size={24} className="text-emerald-400" />
                        <p className="text-sm font-medium text-(--color-text)">
                          {syncStore.userName || syncStore.userEmail}
                        </p>
                        {syncStore.userName && syncStore.userEmail && (
                          <p className="text-xs text-(--color-text-muted)">
                            {syncStore.userEmail}
                          </p>
                        )}
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                          {t("onboarding.cloudConnected")}
                        </span>
                      </div>
                    ) : (
                      <Button
                        size="lg"
                        onClick={() => syncStore.connect()}
                        disabled={syncStore.isConnecting}
                        className="w-full"
                      >
                        {syncStore.isConnecting ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            {t("onboarding.cloudWaiting")}
                          </>
                        ) : (
                          <>
                            <Cloud size={18} />
                            <Link2 size={18} />
                            {t("onboarding.cloudConnect")}
                          </>
                        )}
                      </Button>
                    )}

                    {syncStore.error && (
                      <p className="text-xs text-red-400">{syncStore.error}</p>
                    )}
                  </div>
                </div>
              </WizardStep>
            )}

            {/* Step 3: Create client */}
            {step === 3 && (
              <WizardStep key="client" direction={direction}>
                <div>
                  <h2 className="text-lg font-bold text-(--color-text)">
                    {t("onboarding.step2Title")}
                  </h2>
                  {clientCheckFailed && (
                    <WizardMessage>
                      {t("onboarding.couldNotCheckExistingClients")}
                    </WizardMessage>
                  )}
                  {clientSaveFailed && (
                    <WizardMessage tone="error">
                      {t("projects.couldNotSaveClient")}
                    </WizardMessage>
                  )}

                  {existingClientsCount !== null && existingClientsCount > 0 ? (
                    <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6">
                      <CheckCircle2 size={24} className="text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-400">
                        {t("onboarding.alreadyHaveClients", {
                          count: existingClientsCount,
                        })}
                      </p>
                      <Loader2
                        size={16}
                        className="animate-spin text-(--color-text-muted)"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-(--color-text-muted)">
                        {t("projects.createFirstClient")}
                      </p>
                      <div className="mt-6 space-y-4">
                        <Input
                          label={t("common.name")}
                          value={clientName}
                          onChange={(e) => {
                            setClientName(e.target.value);
                            setClientSaveFailed(false);
                          }}
                          placeholder={t("form.clientNamePlaceholder")}
                          autoFocus
                        />
                        <Input
                          label={t("onboarding.companyLabel")}
                          value={clientCompany}
                          onChange={(e) => setClientCompany(e.target.value)}
                          placeholder={t("form.companyPlaceholder")}
                        />
                      </div>
                    </>
                  )}
                </div>
              </WizardStep>
            )}

            {/* Step 4: Create project */}
            {step === 4 && (
              <WizardStep key="project" direction={direction}>
                <div>
                  <h2 className="text-lg font-bold text-(--color-text)">
                    {t("onboarding.step3Title")}
                  </h2>
                  {projectCheckFailed && (
                    <WizardMessage>
                      {t("onboarding.couldNotCheckExistingProjects")}
                    </WizardMessage>
                  )}
                  {projectSaveFailed && (
                    <WizardMessage tone="error">
                      {t("projects.couldNotSaveProject")}
                    </WizardMessage>
                  )}

                  {existingProjectsCount !== null &&
                  existingProjectsCount > 0 ? (
                    <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6">
                      <CheckCircle2 size={24} className="text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-400">
                        {t("onboarding.alreadyHaveProjects", {
                          count: existingProjectsCount,
                        })}
                      </p>
                      <Loader2
                        size={16}
                        className="animate-spin text-(--color-text-muted)"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-(--color-text-muted)">
                        {createdClient
                          ? `${t("projects.client")}: ${createdClient.name}`
                          : t("projects.createFirstProject")}
                      </p>
                      <div className="mt-6 space-y-4">
                        <Input
                          label={t("projects.projectName")}
                          value={projectName}
                          onChange={(e) => {
                            setProjectName(e.target.value);
                            setProjectSaveFailed(false);
                          }}
                          placeholder={t("form.projectNamePlaceholder")}
                          autoFocus
                        />
                        <Input
                          label={t("projects.hourlyRateKr")}
                          type="number"
                          value={projectRate}
                          onChange={(e) => setProjectRate(e.target.value)}
                          placeholder={t("form.hourlyRatePlaceholder")}
                        />
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-(--color-text-muted)">
                            {t("common.color")}
                          </span>
                          <div className="flex gap-2">
                            {PROJECT_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setProjectColor(color)}
                                className={`h-7 w-7 rounded-full transition-transform ${
                                  projectColor === color
                                    ? "scale-110 ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-bg)"
                                    : "hover:scale-105"
                                }`}
                                style={{ backgroundColor: color }}
                                aria-label={t("projects.selectColor", {
                                  color,
                                })}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </WizardStep>
            )}

            {/* Step 5: AI config */}
            {step === 5 && (
              <WizardStep key="ai" direction={direction}>
                <div>
                  <h2 className="text-lg font-bold text-(--color-text)">
                    {t("onboarding.step4Title")}
                  </h2>
                  <p className="mt-1 text-sm text-(--color-text-muted)">
                    {t("ai.providerDescription")}
                  </p>
                  {aiSaveFailed && (
                    <WizardMessage tone="error">
                      {t("common.couldNotSave")}
                    </WizardMessage>
                  )}
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-(--color-text-muted)">
                        {t("ai.providerTitle")}
                      </span>
                      <select
                        value={aiProvider}
                        onChange={(e) => setAiProvider(e.target.value)}
                        aria-label={t("ai.providerTitle")}
                        className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
                      >
                        {AI_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.labelKey ? t(p.labelKey) : p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {aiProvider !== "ollama" && (
                      <Input
                        label={t("ai.apiKeyTitle")}
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder={
                          AI_PROVIDERS.find((p) => p.value === aiProvider)
                            ?.placeholder || t("ai.apiKeyPlaceholder")
                        }
                      />
                    )}
                    <p className="text-xs text-(--color-text-muted)">
                      {t("ai.apiKeyDescription")}
                    </p>
                  </div>
                </div>
              </WizardStep>
            )}

            {/* Step 6: All done */}
            {step === 6 && (
              <WizardStep key="done" direction={direction}>
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500">
                    <Rocket size={32} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-(--color-text)">
                    {t("onboarding.step5Title")}
                  </h2>
                  <p className="mt-3 max-w-sm text-sm text-(--color-text-muted)">
                    {t("onboarding.step5Desc")}
                  </p>
                  <div className="mt-8">
                    <Button size="lg" onClick={handleFinish} disabled={saving}>
                      <Check size={18} />
                      {t("onboarding.startTracking")}
                    </Button>
                  </div>
                </div>
              </WizardStep>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        {step < 6 && (
          <div className="mt-8 flex items-center justify-between">
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ArrowLeft size={14} />
                {t("common.back")}
              </Button>
            ) : (
              <div />
            )}

            {/* Step 0: Welcome */}
            {step === 0 && (
              <Button size="sm" onClick={goNext}>
                {t("common.next")}
                <ArrowRight size={14} />
              </Button>
            )}

            {/* Step 1: License — MUST activate or start trial */}
            {step === 1 && (
              <div>
                {hasLicenseOrTrial ? (
                  <Button size="sm" onClick={goNext}>
                    {t("common.next")}
                    <ArrowRight size={14} />
                  </Button>
                ) : (
                  <p className="max-w-[200px] text-right text-xs text-(--color-text-muted)">
                    {t("onboarding.licenseRequired")}
                  </p>
                )}
              </div>
            )}

            {/* Step 2: Cloud sync — skip link prominent */}
            {step === 2 && (
              <div className="flex flex-col items-end gap-2">
                {syncStore.isLoggedIn ? (
                  <Button size="sm" onClick={goNext}>
                    {t("common.next")}
                    <ArrowRight size={14} />
                  </Button>
                ) : (
                  !syncStore.isConnecting && (
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={goNext}
                        className="text-sm text-(--color-text-muted) hover:text-(--color-text) underline underline-offset-2 transition-colors"
                      >
                        {t("onboarding.cloudSkip")}
                      </button>
                      <span className="text-xs text-(--color-text-muted)">
                        {t("onboarding.cloudSkipHint")}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Step 3: Create client */}
            {step === 3 && (
              <div className="flex gap-2">
                {(!clientName.trim() || clientSaveFailed) && (
                  <Button variant="ghost" size="sm" onClick={goNext}>
                    {t("onboarding.step4Skip")}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleCreateClient}
                  disabled={saving}
                >
                  {clientName.trim()
                    ? t("projects.newClient")
                    : t("common.next")}
                  <ArrowRight size={14} />
                </Button>
              </div>
            )}

            {/* Step 4: Create project */}
            {step === 4 && (
              <div className="flex gap-2">
                {(!projectName.trim() || projectSaveFailed) && (
                  <Button variant="ghost" size="sm" onClick={goNext}>
                    {t("onboarding.step4Skip")}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleCreateProject}
                  disabled={saving}
                >
                  {projectName.trim()
                    ? t("projects.newProject")
                    : t("common.next")}
                  <ArrowRight size={14} />
                </Button>
              </div>
            )}

            {/* Step 5: AI config */}
            {step === 5 && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={goNext}>
                  {t("onboarding.step4Skip")}
                </Button>
                {aiApiKey.trim() && (
                  <Button
                    size="sm"
                    onClick={handleSaveAiConfig}
                    disabled={saving}
                  >
                    {t("common.save")}
                    <ArrowRight size={14} />
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
