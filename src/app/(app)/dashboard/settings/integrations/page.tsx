"use client";

import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Link2,
  Link2Off,
  Loader2,
  Mail,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Shuffle,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { ICloudCalendarSection } from "@/components/calendar/ICloudCalendarSection";
import { PageHeader } from "@/components/dashboard-nav";
import { ConnectedAiAppsSection } from "@/components/settings/ConnectedAiAppsSection";
import { ConfirmDialog } from "@/components/ui";
import { InlineSpinner, LoadingScreen } from "@/components/ui/LoadingScreen";
import { switchThumb, switchTrack } from "@/components/ui/switch-styles";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { DEMO_UNAVAILABLE_CODE } from "@/lib/demo/demo-mode";
import { trpc } from "@/providers/trpc-provider";

interface SyncLog {
  id: string;
  integrationType: string;
  operation: string;
  status: string;
  itemsProcessed: number | null;
  itemsFailed: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export default function IntegrationsPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const fid = useId();
  const t = useTranslations("settingsIntegrations");
  const locale = useLocale();
  const intl = toIntlLocale(locale);
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();

  // Form state
  const [billyApiKey, setBillyApiKey] = useState("");

  // Test connection states
  const [testingBilly, setTestingBilly] = useState(false);
  const [testingDinero, setTestingDinero] = useState(false);

  // Extension token state
  const [newTokenName, setNewTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [showGeneratedToken, setShowGeneratedToken] = useState(false);
  const [revokeTokenConfirmId, setRevokeTokenConfirmId] = useState<
    string | null
  >(null);
  const [showDisconnectCalendarConfirm, setShowDisconnectCalendarConfirm] =
    useState(false);

  // Queries
  const { isLoading: profileLoading } = trpc.user.getProfile.useQuery();

  const { data: syncHistory, isLoading: syncHistoryLoading } =
    trpc.integrations.getSyncHistory.useQuery({ limit: 100 });

  const { data: integrationStatus } = trpc.user.getIntegrationStatus.useQuery();

  const { data: billyConnectionStatus, refetch: refetchBillyStatus } =
    trpc.integrations.testBillyConnection.useQuery(undefined, {
      enabled: !!integrationStatus?.hasBillyApiKey,
    });

  const { data: dineroConnectionStatus, refetch: refetchDineroStatus } =
    trpc.integrations.testDineroConnection.useQuery(undefined, {
      enabled: !!integrationStatus?.dineroConnected,
    });

  const { data: dineroLineSettings } =
    trpc.integrations.getDineroLineSettings.useQuery(undefined, {
      enabled: !!integrationStatus?.dineroConnected,
    });
  const { data: dineroAccounts } = trpc.integrations.getDineroAccounts.useQuery(
    undefined,
    {
      enabled: !!integrationStatus?.dineroConnected,
      retry: false,
    },
  );
  const { data: pendingDineroOrgs } =
    trpc.integrations.getPendingDineroOrgs.useQuery(undefined, {
      enabled: searchParams.get("pending") === "dinero_org_select",
    });
  const { data: dineroProducts } = trpc.integrations.getDineroProducts.useQuery(
    undefined,
    {
      enabled: !!integrationStatus?.dineroConnected,
      retry: false,
    },
  );
  const { data: dineroProductMapping } =
    trpc.integrations.getDineroProductMapping.useQuery(undefined, {
      enabled: !!integrationStatus?.dineroConnected,
    });
  const [dineroDefaultAccount, setDineroDefaultAccount] = useState<string>("");
  useEffect(() => {
    if (dineroLineSettings?.defaultAccountNumber !== undefined) {
      setDineroDefaultAccount(
        dineroLineSettings.defaultAccountNumber?.toString() ?? "",
      );
    }
  }, [dineroLineSettings?.defaultAccountNumber]);

  const setDineroDefaultAccountMutation =
    trpc.integrations.setDineroDefaultAccount.useMutation({
      onSuccess: () => {
        utils.integrations.getDineroLineSettings.invalidate();
        toast.success(t("defaultAccountSaved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSaveTheAccount"));
      },
    });

  const completeDineroConnectionMutation =
    trpc.integrations.completeDineroConnection.useMutation({
      onSuccess: (data) => {
        utils.user.getIntegrationStatus.invalidate();
        utils.integrations.testDineroConnection.invalidate();
        utils.integrations.getPendingDineroOrgs.invalidate();
        toast.success(t("connectedToOrg", { name: data.orgName }));
        router.replace("/dashboard/settings/integrations");
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotCompleteTheConnection"));
      },
    });

  const setDineroProductMappingMutation =
    trpc.integrations.setDineroProductMapping.useMutation({
      onSuccess: () => {
        utils.integrations.getDineroProductMapping.invalidate();
        toast.success(t("productMappingSaved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSaveTheProduct"));
      },
    });

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [productGuidTime, setProductGuidTime] = useState<string>("");
  const [productGuidKlippekort, setProductGuidKlippekort] =
    useState<string>("");

  useEffect(() => {
    if (dineroProductMapping) {
      setProductGuidTime(dineroProductMapping.productGuidTime ?? "");
      setProductGuidKlippekort(
        dineroProductMapping.productGuidKlippekort ?? "",
      );
    }
  }, [dineroProductMapping]);

  // Extension token queries
  const { data: extensionTokens, isLoading: tokensLoading } =
    trpc.extension.listTokens.useQuery();

  // Extension token mutations
  const generateTokenMutation = trpc.extension.generateToken.useMutation({
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setShowGeneratedToken(true);
      setNewTokenName("");
      utils.extension.listTokens.invalidate();
      toast.success(t("tokenGenerated"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotGenerateTheToken"));
    },
  });

  const revokeTokenMutation = trpc.extension.revokeToken.useMutation({
    onSuccess: () => {
      utils.extension.listTokens.invalidate();
      toast.success(t("tokenRevoked"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotRevokeTheToken"));
    },
  });

  // Google Calendar queries
  const { data: calendarConfigured } = trpc.calendar.isConfigured.useQuery();
  const { data: calendarStatus } = trpc.calendar.getConnectionStatus.useQuery();
  // getConnectionStatus falder tilbage til iCloud — Google-kortet skal kun
  // vise Google-forbindelsen
  const googleCalendarStatus =
    calendarStatus?.provider === "google" ? calendarStatus : null;

  // Google Calendar mutations
  const connectCalendarMutation = trpc.calendar.getAuthUrl.useMutation({
    onSuccess: (data) => {
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API mangler i Safari/Firefox, og OAuth-staten skal ligge i cookien før redirect
      document.cookie = `google_oauth_state=${data.state}; path=/; max-age=600; SameSite=Lax`;
      window.location.href = data.url;
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotConnectToGoogle"));
    },
  });

  const disconnectCalendarMutation = trpc.calendar.disconnect.useMutation({
    onSuccess: () => {
      utils.calendar.getConnectionStatus.invalidate();
      toast.success(t("googleCalendarDisconnected"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotDisconnectGoogleCalendar"));
    },
  });

  const syncCalendarMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      utils.calendar.getConnectionStatus.invalidate();
      if (data.success) {
        toast.success(
          t("calendarSynced", {
            synced: data.synced ?? 0,
            updated: data.updated ?? 0,
          }),
        );
      } else {
        toast.error(data.error || t("syncFailed"));
      }
    },
    onError: (error) => {
      toast.error(error.message || t("syncFailed"));
    },
  });

  // Dinero OAuth connect — delegates to the server-side start route
  // which generates state/nonce/PKCE verifier and sets HttpOnly cookies
  // before redirecting to Visma.
  const dineroGetAuthUrlMutation = {
    mutate: () => {
      window.location.href = "/api/integrations/dinero/start";
    },
    isPending: false,
  };

  const dineroDisconnectMutation =
    trpc.integrations.dineroDisconnect.useMutation({
      onSuccess: () => {
        utils.user.getIntegrationStatus.invalidate();
        utils.integrations.testDineroConnection.invalidate();
        toast.success(t("dineroDisconnected"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotDisconnectDinero"));
      },
    });

  // e-conomic connect — delegates to the server-side start route which
  // sets the HttpOnly CSRF cookie before redirecting to e-conomic.
  const economicGetAuthUrlMutation = {
    mutate: () => {
      window.location.href = "/api/integrations/economic/start";
    },
    isPending: false,
  };

  const economicDisconnectMutation =
    trpc.integrations.economicDisconnect.useMutation({
      onSuccess: () => {
        utils.user.getIntegrationStatus.invalidate();
        toast.success(t("eConomicDisconnected"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotDisconnectEConomic"));
      },
    });

  // e-conomic settings hooks
  const { data: economicAgreementInfo } =
    trpc.integrations.getEconomicAgreementInfo.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });
  const { data: economicProducts } =
    trpc.integrations.getEconomicProducts.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });
  const { data: economicProductMapping } =
    trpc.integrations.getEconomicProductMapping.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });
  const { data: economicLayouts } =
    trpc.integrations.getEconomicLayouts.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });
  const { data: economicPaymentTerms } =
    trpc.integrations.getEconomicPaymentTerms.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });
  const { data: economicLineSettings } =
    trpc.integrations.getEconomicLineSettings.useQuery(undefined, {
      enabled: !!integrationStatus?.economicConnected,
    });

  const setEconomicProductMappingMutation =
    trpc.integrations.setEconomicProductMapping.useMutation({
      onSuccess: () => {
        toast.success(t("productMappingSaved"));
        utils.integrations.getEconomicProductMapping.invalidate();
      },
    });
  const setEconomicDefaultLayoutMutation =
    trpc.integrations.setEconomicDefaultLayout.useMutation({
      onSuccess: () => {
        toast.success(t("defaultLayoutSaved"));
        utils.integrations.getEconomicLineSettings.invalidate();
      },
    });
  const setEconomicDefaultPaymentTermsMutation =
    trpc.integrations.setEconomicDefaultPaymentTerms.useMutation({
      onSuccess: () => {
        toast.success(t("paymentTermsSaved"));
        utils.integrations.getEconomicLineSettings.invalidate();
      },
    });
  const setEconomicLineSettingsMutation =
    trpc.integrations.setEconomicLineSettings.useMutation({
      onSuccess: () => {
        toast.success(t("lineSettingsSaved"));
        utils.integrations.getEconomicLineSettings.invalidate();
      },
    });

  const [economicProductTime, setEconomicProductTime] = useState("");
  const [economicProductKlippekort, setEconomicProductKlippekort] =
    useState("");
  const [economicLayout, setEconomicLayout] = useState("");
  const [economicPaymentTerm, setEconomicPaymentTerm] = useState("");
  const [economicLineType, setEconomicLineType] = useState<
    "per_entry" | "combined"
  >("per_entry");
  const [economicLineTemplate, setEconomicLineTemplate] = useState(
    "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
  );

  useEffect(() => {
    if (economicProductMapping) {
      setEconomicProductTime(economicProductMapping.defaultProductNumber || "");
      setEconomicProductKlippekort(
        economicProductMapping.klippekortProductNumber || "",
      );
    }
  }, [economicProductMapping]);

  useEffect(() => {
    if (economicLineSettings) {
      setEconomicLineType(economicLineSettings.lineType);
      setEconomicLineTemplate(economicLineSettings.lineTemplate);
      setEconomicLayout(
        economicLineSettings.defaultLayoutNumber?.toString() || "",
      );
      setEconomicPaymentTerm(
        economicLineSettings.defaultPaymentTermsNumber?.toString() || "",
      );
    }
  }, [economicLineSettings]);

  // Handle OAuth callback messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL-resultatet må kun vises én gang, ikke igen ved sprogskift, så t står ikke i deps
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "google_connected") {
      const access = searchParams.get("access");
      toast.success(
        access === "read_write"
          ? t("googleConnectedRw")
          : access === "read"
            ? t("googleConnectedRead")
            : t("googleConnected"),
      );
      utils.calendar.getConnectionStatus.invalidate();
      router.replace("/dashboard/settings/integrations");
    }

    if (success === "dinero_connected") {
      toast.success(t("dineroIsNowConnected"));
      utils.user.getIntegrationStatus.invalidate();
      utils.integrations.testDineroConnection.invalidate();
      router.replace("/dashboard/settings/integrations");
    }

    if (success === "economic_connected") {
      toast.success(t("eConomicIsNowConnected"));
      utils.user.getIntegrationStatus.invalidate();
      router.replace("/dashboard/settings/integrations");
    }

    if (error === "dinero_no_pro_org") {
      toast.error(t("noDineroPro"));
      router.replace("/dashboard/settings/integrations");
    } else if (error === DEMO_UNAVAILABLE_CODE) {
      toast.info(t("demoUnavailable"));
      router.replace("/dashboard/settings/integrations");
    } else if (error) {
      toast.error(t("errorFromUrl", { message: decodeURIComponent(error) }));
      router.replace("/dashboard/settings/integrations");
    }
  }, [
    searchParams,
    router,
    utils.calendar.getConnectionStatus,
    utils.user.getIntegrationStatus,
    utils.integrations.testDineroConnection,
  ]);

  // Mutations
  const updateIntegrationsMutation = trpc.user.updateIntegrations.useMutation({
    onSuccess: () => {
      toast.success(t("integrationSettingsSaved"));
      utils.user.getProfile.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotSaveTheIntegration"));
    },
  });

  if (isPending || profileLoading) {
    return <LoadingScreen message={t("loadingIntegrations")} />;
  }

  if (!session) {
    return null;
  }

  const handleTestBilly = async () => {
    setTestingBilly(true);
    await refetchBillyStatus();
    setTestingBilly(false);
  };

  const handleSaveBilly = async () => {
    if (!billyApiKey) {
      toast.error(t("enterAnApiKey"));
      return;
    }
    await updateIntegrationsMutation.mutateAsync({
      billyApiKey,
    });
  };

  const handleGenerateToken = async () => {
    if (!newTokenName.trim()) {
      toast.error(t("enterANameForYour"));
      return;
    }
    await generateTokenMutation.mutateAsync({ name: newTokenName.trim() });
  };

  const handleRevokeToken = (tokenId: string) => {
    setRevokeTokenConfirmId(tokenId);
  };

  const handleCopyToken = async () => {
    if (generatedToken) {
      await navigator.clipboard.writeText(generatedToken);
      toast.success(t("tokenCopiedToClipboard"));
    }
  };

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <PageHeader
          title={t("integrations")}
          description={t("pageDescription", { brand: brand.name })}
        />

        {/* Email-to-Task Integration */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-tt-gran-lys text-brand-600 dark:text-brand-400">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("emailTasks")}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("connectYourImapInboxAnd")}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/settings/email?tab=integration"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("configure")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* TimeOps Import */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                <ArrowDownToLine className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("importFromTimeops")}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("moveYourClientsProjectsTime", { brand: brand.name })}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/integrations/import-timeops"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("startImport")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Default Integration Preferences */}
        <DefaultIntegrationCard />

        {/* Billy Integration */}
        <IntegrationCard
          name="Billy"
          description={t("billyIsAPopularDanish")}
          logoColor="bg-green-500"
          docsUrl="https://www.billy.dk/api"
          isConnected={billyConnectionStatus?.connected || false}
          isTesting={testingBilly}
          isSaving={updateIntegrationsMutation.isPending}
          onTest={handleTestBilly}
          onSave={handleSaveBilly}
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="billyApiKey"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {t("apiKey")}
              </label>
              <input
                id="billyApiKey"
                type="password"
                value={billyApiKey}
                onChange={(e) => setBillyApiKey(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder={
                  integrationStatus?.hasBillyApiKey
                    ? t("billyKeyPlaceholderSaved")
                    : t("billyKeyPlaceholder")
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("findYourApiKeyIn")}
              </p>
            </div>

            {/* Billy Product Selector */}
            {billyConnectionStatus?.connected && <BillyProductSelector />}
          </div>
        </IntegrationCard>

        {/* Dinero Integration */}
        <div
          id="dinero"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
              <Puzzle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Dinero
                  </h2>
                  {integrationStatus?.dineroConnected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("connected")}
                    </span>
                  )}
                </div>
                <a
                  href="https://api.dinero.dk/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-brand-600 hover:underline dark:text-brand-400 flex items-center gap-1"
                >
                  {t("documentation")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("dineroIsAUserFriendly")}
              </p>

              <div className="mt-4 space-y-4">
                {/* Connected via OAuth */}
                {integrationStatus?.dineroIsOAuth && (
                  <>
                    {integrationStatus.dineroTokenExpired ? (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
                        <p className="text-sm text-amber-800 dark:text-amber-300">
                          <strong>
                            {t("dineroExpired", {
                              name: integrationStatus.dineroOrgName || "Dinero",
                            })}
                          </strong>{" "}
                          {t("disconnectAndReconnectToRenew")}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
                        <p className="text-sm text-green-800 dark:text-green-300">
                          {t.rich("dineroViaOauth", {
                            name: integrationStatus.dineroOrgName || "Dinero",
                            b: (chunks) => (
                              <span className="font-medium">{chunks}</span>
                            ),
                          })}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTestingDinero(true);
                          refetchDineroStatus().finally(() =>
                            setTestingDinero(false),
                          );
                        }}
                        disabled={testingDinero}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        {testingDinero ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {t("testConnection")}
                      </button>
                      <button
                        type="button"
                        onClick={() => dineroDisconnectMutation.mutate()}
                        disabled={dineroDisconnectMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-700 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      >
                        {dineroDisconnectMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Link2Off className="h-4 w-4" />
                        )}
                        {t("disconnect")}
                      </button>
                    </div>
                    {dineroConnectionStatus &&
                      !dineroConnectionStatus.connected && (
                        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
                          <p className="text-sm text-red-800 dark:text-red-300">
                            {dineroConnectionStatus.message}
                          </p>
                        </div>
                      )}

                    {/* Default income-account.
                          Required by Dinero for invoice lines. When the
                          chart of accounts is available we render a
                          dropdown; otherwise we fall back to a numeric
                          input (e.g. if the /accounts/entry endpoint is
                          temporarily unreachable). */}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <label
                        htmlFor="dinero-default-account"
                        className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        {t("defaultRevenueAccount")}
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("theAccountInDineroYour")}
                      </p>
                      <div className="flex gap-2">
                        {dineroAccounts && dineroAccounts.length > 0 ? (
                          <select
                            id="dinero-default-account"
                            value={dineroDefaultAccount}
                            onChange={(e) =>
                              setDineroDefaultAccount(e.target.value)
                            }
                            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          >
                            <option value="">{t("chooseAccount")}</option>
                            {dineroAccounts.map((a) => (
                              <option
                                key={a.accountNumber}
                                value={a.accountNumber}
                              >
                                {a.accountNumber} {a.name}
                                {a.vatCode ? ` (${a.vatCode})` : ""}
                                {a.isDefaultSalesAccount ? " · standard" : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id="dinero-default-account"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={dineroDefaultAccount}
                            onChange={(e) =>
                              setDineroDefaultAccount(e.target.value)
                            }
                            placeholder={t("eG1010")}
                            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const n = Number.parseInt(dineroDefaultAccount, 10);
                            setDineroDefaultAccountMutation.mutate({
                              accountNumber:
                                Number.isFinite(n) && n > 0 ? n : null,
                            });
                          }}
                          disabled={setDineroDefaultAccountMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                        >
                          {t("save")}
                        </button>
                      </div>
                    </div>

                    {/* Product mapping for timer vs. klippekort */}
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                        {t("productMapping")}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("chooseDineroProductsForCorrect")}
                      </p>

                      <div className="space-y-3 pt-1">
                        <div>
                          <label
                            htmlFor="dinero-product-time"
                            className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                          >
                            {t("productForHours")}
                          </label>
                          {dineroProducts && dineroProducts.length > 0 ? (
                            <select
                              id="dinero-product-time"
                              value={productGuidTime}
                              onChange={(e) =>
                                setProductGuidTime(e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                            >
                              <option value="">{t("noneUseAccount")}</option>
                              {dineroProducts.map((p) => (
                                <option
                                  key={p.productGuid}
                                  value={p.productGuid}
                                >
                                  {p.name}
                                  {p.productNumber
                                    ? ` (${p.productNumber})`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-xs text-gray-400 italic">
                              {t("noProductsFoundInDinero")}
                            </p>
                          )}
                        </div>

                        <div>
                          <label
                            htmlFor="dinero-product-klippekort"
                            className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                          >
                            {t("productForPrepaidPackages")}
                          </label>
                          {dineroProducts && dineroProducts.length > 0 ? (
                            <select
                              id="dinero-product-klippekort"
                              value={productGuidKlippekort}
                              onChange={(e) =>
                                setProductGuidKlippekort(e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                            >
                              <option value="">{t("noneUseAccount")}</option>
                              {dineroProducts.map((p) => (
                                <option
                                  key={p.productGuid}
                                  value={p.productGuid}
                                >
                                  {p.name}
                                  {p.productNumber
                                    ? ` (${p.productNumber})`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-xs text-gray-400 italic">
                              {t("noProductsFoundInDinero")}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setDineroProductMappingMutation.mutate({
                              productGuidTime: productGuidTime || null,
                              productGuidKlippekort:
                                productGuidKlippekort || null,
                            });
                          }}
                          disabled={setDineroProductMappingMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                        >
                          {t("saveProductMapping")}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Connected via legacy API key (migration banner) */}
                {!integrationStatus?.dineroIsOAuth &&
                  integrationStatus?.dineroConnected && (
                    <>
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
                        <p className="text-sm text-amber-800 dark:text-amber-300">
                          <strong>{t("upgradeToOauth")}</strong>{" "}
                          {t("dineroNowUsesOauth2")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => dineroGetAuthUrlMutation.mutate()}
                          disabled={dineroGetAuthUrlMutation.isPending}
                          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                        >
                          {dineroGetAuthUrlMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4" />
                          )}
                          {t("upgradeToOauth2")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTestingDinero(true);
                            refetchDineroStatus().finally(() =>
                              setTestingDinero(false),
                            );
                          }}
                          disabled={testingDinero}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                        >
                          {testingDinero ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {t("testConnection")}
                        </button>
                      </div>
                    </>
                  )}

                {/* Pending org selection — user has multiple pro orgs */}
                {pendingDineroOrgs &&
                  pendingDineroOrgs.organizations.length > 0 && (
                    <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4 space-y-3">
                      <p className="text-sm font-medium text-brand-800 dark:text-brand-200">
                        {t("youHaveAccessToSeveral")}
                      </p>
                      <div className="space-y-2">
                        {pendingDineroOrgs.organizations.map((org) => (
                          <label
                            key={org.id}
                            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                              selectedOrgId === org.id
                                ? "border-brand-500 bg-brand-100 dark:bg-tt-gran-lys"
                                : "border-gray-200 dark:border-gray-700 hover:border-brand-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name="dinero-org"
                              value={org.id}
                              checked={selectedOrgId === org.id}
                              onChange={() => setSelectedOrgId(org.id)}
                              className="text-brand-600 dark:text-brand-400"
                            />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {org.name}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedOrgId) {
                            completeDineroConnectionMutation.mutate({
                              organizationId: selectedOrgId,
                            });
                          }
                        }}
                        disabled={
                          !selectedOrgId ||
                          completeDineroConnectionMutation.isPending
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                      >
                        {completeDineroConnectionMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Link2 className="h-4 w-4" />
                        )}
                        {t("connectToTheSelectedOrganisation")}
                      </button>
                    </div>
                  )}

                {/* Not connected — show connect button */}
                {!integrationStatus?.dineroConnected && (
                  <button
                    type="button"
                    onClick={() => dineroGetAuthUrlMutation.mutate()}
                    disabled={dineroGetAuthUrlMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                  >
                    {dineroGetAuthUrlMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {t("connectToDinero")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* e-conomic Integration */}
        <div
          id="economic"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <div className="mb-6 flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-purple-500 flex items-center justify-center shrink-0">
                <Puzzle className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    e-conomic
                  </h2>
                  {integrationStatus?.economicConnected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      {t("connected")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t("syncInvoicesAndClientsWith")}
                </p>
              </div>
            </div>
          </div>

          {integrationStatus?.economicConnected ? (
            <div className="space-y-4">
              {/* Agreement info */}
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      {t("economicConnectedTo", {
                        name: economicAgreementInfo?.companyName || "e-conomic",
                      })}
                    </p>
                    {economicAgreementInfo?.agreementNumber && (
                      <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                        {t("agreementNo", {
                          number: economicAgreementInfo.agreementNumber,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Layout selector */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <label
                  htmlFor={`${fid}-f1`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("defaultInvoiceLayout")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("chooseWhichLayoutTemplateIs")}
                </p>
                <div className="flex gap-2">
                  <select
                    id={`${fid}-f1`}
                    value={economicLayout}
                    onChange={(e) => setEconomicLayout(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  >
                    <option value="">{t("default")}</option>
                    {economicLayouts?.map((l) => (
                      <option key={l.layoutNumber} value={l.layoutNumber}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setEconomicDefaultLayoutMutation.mutate({
                        layoutNumber: economicLayout
                          ? Number(economicLayout)
                          : null,
                      })
                    }
                    disabled={setEconomicDefaultLayoutMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                </div>
              </div>

              {/* Payment terms selector */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <label
                  htmlFor={`${fid}-f2`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("defaultPaymentTerms")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("usedByDefaultWhenExporting")}
                </p>
                <div className="flex gap-2">
                  <select
                    id={`${fid}-f2`}
                    value={economicPaymentTerm}
                    onChange={(e) => setEconomicPaymentTerm(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  >
                    <option value="">{t("choose")}</option>
                    {economicPaymentTerms?.map((pt) => (
                      <option
                        key={pt.paymentTermsNumber}
                        value={pt.paymentTermsNumber}
                      >
                        {t("paymentTermOption", {
                          name: pt.name,
                          days: pt.daysOfCredit,
                        })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setEconomicDefaultPaymentTermsMutation.mutate({
                        paymentTermsNumber: economicPaymentTerm
                          ? Number(economicPaymentTerm)
                          : null,
                      })
                    }
                    disabled={setEconomicDefaultPaymentTermsMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                </div>
              </div>

              {/* Product mapping */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("productMapping")}
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("chooseEConomicProductsFor")}
                </p>
                <div className="space-y-3 pt-1">
                  <div>
                    <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t("productForHours")}
                    </span>
                    {economicProducts && economicProducts.length > 0 ? (
                      <select
                        value={economicProductTime}
                        onChange={(e) => setEconomicProductTime(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      >
                        <option value="">{t("noProduct")}</option>
                        {economicProducts.map((p) => (
                          <option key={p.productNumber} value={p.productNumber}>
                            {p.name} ({p.productNumber})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-gray-400 italic">
                        {t("noProductsFoundInE")}
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t("productForPrepaidPackages")}
                    </span>
                    {economicProducts && economicProducts.length > 0 ? (
                      <select
                        value={economicProductKlippekort}
                        onChange={(e) =>
                          setEconomicProductKlippekort(e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      >
                        <option value="">{t("sameAsDefault")}</option>
                        {economicProducts.map((p) => (
                          <option key={p.productNumber} value={p.productNumber}>
                            {p.name} ({p.productNumber})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-gray-400 italic">
                        {t("noProductsFoundInE")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEconomicProductMappingMutation.mutate({
                        defaultProductNumber: economicProductTime || null,
                        klippekortProductNumber:
                          economicProductKlippekort || null,
                      })
                    }
                    disabled={setEconomicProductMappingMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {t("saveProductMapping")}
                  </button>
                </div>
              </div>

              {/* Line settings */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("lineSettings")}
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("determinesHowTimeEntriesAppear")}
                </p>
                <div className="space-y-3 pt-1">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="economic-line-type"
                        checked={economicLineType === "per_entry"}
                        onChange={() => setEconomicLineType("per_entry")}
                        className="text-purple-600"
                      />
                      {t("perEntryLine")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="economic-line-type"
                        checked={economicLineType === "combined"}
                        onChange={() => setEconomicLineType("combined")}
                        className="text-purple-600"
                      />
                      {t("combinedLine")}
                    </label>
                  </div>
                  {economicLineType === "per_entry" && (
                    <div>
                      <label
                        htmlFor={`${fid}-f3`}
                        className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                      >
                        {t("lineDescriptionTemplate")}
                      </label>
                      <input
                        id={`${fid}-f3`}
                        type="text"
                        value={economicLineTemplate}
                        onChange={(e) =>
                          setEconomicLineTemplate(e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Variabler: {"{{beskrivelse}}"}, {"{{dato}}"},{" "}
                        {"{{tidsforbrug}}"}, {"{{sats}}"}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setEconomicLineSettingsMutation.mutate({
                        lineType: economicLineType,
                        lineTemplate: economicLineTemplate,
                      })
                    }
                    disabled={setEconomicLineSettingsMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {t("saveLineSettings")}
                  </button>
                </div>
              </div>

              {/* Disconnect */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => economicDisconnectMutation.mutate()}
                  disabled={economicDisconnectMutation.isPending}
                  className="rounded-lg border border-red-300 dark:border-red-700 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {economicDisconnectMutation.isPending
                    ? t("disconnecting")
                    : t("disconnectConnection")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("economicIntro", { brand: brand.name })}
              </p>
              <button
                type="button"
                onClick={() => economicGetAuthUrlMutation.mutate()}
                disabled={economicGetAuthUrlMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {economicGetAuthUrlMutation.isPending
                  ? t("redirecting")
                  : t("connectEconomic")}
              </button>
            </div>
          )}
        </div>

        {/* Google Calendar Integration */}
        <div
          id="google-kalender"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <div className="mb-6 flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Google Calendar
                  </h2>
                  {googleCalendarStatus?.connected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      {t("connected")}
                    </span>
                  )}
                  {googleCalendarStatus?.connected &&
                    googleCalendarStatus.accessLevel && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                        <Eye className="h-3 w-3" />
                        {googleCalendarStatus.accessLevel === "read_write"
                          ? t("readWrite")
                          : t("readOnly")}
                      </span>
                    )}
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t("syncYourGoogleCalendarTo")}
                </p>
              </div>
            </div>
          </div>

          {!calendarConfigured?.configured ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                {calendarConfigured?.comingSoon ? (
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t("googleCalendarComingSoon")}
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      {t("googleCalendarComingSoonBody")}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t("googleCalendarIntegrationIsNot")}
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      {t("contactAnAdministratorToEnable")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : googleCalendarStatus?.connected ? (
            <div className="space-y-4">
              {/* Connected status */}
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      {t("connectedToOrg", {
                        name: googleCalendarStatus.accountEmail ?? "",
                      })}
                    </p>
                    {googleCalendarStatus.lastSynced && (
                      <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                        {t("lastSynced", {
                          date: new Date(
                            googleCalendarStatus.lastSynced,
                          ).toLocaleString(intl),
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Access level */}
              {googleCalendarStatus.accessLevel === "read" ? (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {t("readOnlyTitle", { brand: brand.name })}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {t("weCanSeeYourEvents")}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      connectCalendarMutation.mutate({ write: true })
                    }
                    disabled={connectCalendarMutation.isPending}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {connectCalendarMutation.isPending ? (
                      <InlineSpinner className="h-4 w-4" />
                    ) : (
                      <Key className="h-4 w-4" />
                    )}
                    {t("grantWriteAccess")}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t.rich("readWriteNote", {
                    brand: brand.name,
                    link: (chunks) => (
                      <a
                        href="https://myaccount.google.com/connections"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              )}

              {/* Error display */}
              {googleCalendarStatus.error && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                  <div className="flex items-start gap-3">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-800 dark:text-red-200">
                        {t("syncError")}
                      </p>
                      <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                        {googleCalendarStatus.error}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => syncCalendarMutation.mutate()}
                  disabled={syncCalendarMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncCalendarMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {t("syncing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      {t("syncNow")}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisconnectCalendarConfirm(true)}
                  disabled={disconnectCalendarMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {disconnectCalendarMutation.isPending ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
                      {t("disconnecting")}
                    </>
                  ) : (
                    <>
                      <Link2Off className="h-4 w-4" />
                      {t("disconnect2")}
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("connectYourGoogleCalendarTo")}
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                <li>{t("seeMeetings", { brand: brand.name })}</li>
                <li>{t("automaticallySuggestFreeTimesFor")}</li>
                <li>{t("getABetterOverviewOf")}</li>
              </ul>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("weOnlyAskForRead")}
              </p>
              <button
                type="button"
                onClick={() => connectCalendarMutation.mutate()}
                disabled={connectCalendarMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connectCalendarMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t("connecting")}
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4" />
                    {t("connectGoogleCalendar")}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* iCloud / CalDAV (#676) */}
        <ICloudCalendarSection />

        {/* Calendar Matching Rules */}
        {calendarStatus?.connected && <MatchingRulesSection />}

        {/* Forbundne AI-apps via OAuth/MCP (#912) */}
        <ConnectedAiAppsSection />

        {/* Browser Extension */}
        <div
          id="browserudvidelse"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <div className="mb-6 flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
                <Puzzle className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("browserExtension")}
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t("logTimeDirectlyFromYour")}
                </p>
              </div>
            </div>
          </div>

          {/* Generate New Token */}
          <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              {t("generateANewApiToken")}
            </h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder={t("nameEGChromeExtension")}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <button
                type="button"
                onClick={handleGenerateToken}
                disabled={
                  generateTokenMutation.isPending || !newTokenName.trim()
                }
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generateTokenMutation.isPending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t("generate")}
              </button>
            </div>
          </div>

          {/* Generated Token Display */}
          {generatedToken && (
            <div className="mb-6 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                    {t("yourTokenHasBeenGenerated")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700 px-3 py-2 text-sm font-mono text-gray-900 dark:text-white overflow-x-auto">
                      {showGeneratedToken
                        ? generatedToken
                        : "••••••••••••••••••••••••••••••••"}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowGeneratedToken(!showGeneratedToken)}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      title={
                        showGeneratedToken ? t("hideToken") : t("showToken")
                      }
                    >
                      {showGeneratedToken ? (
                        <EyeOff className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                    >
                      <Copy className="h-4 w-4" />
                      {t("copy")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Existing Tokens List */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
              {t("activeTokens")}
            </h3>
            {tokensLoading ? (
              <div className="flex items-center justify-center py-8">
                <InlineSpinner className="h-6 w-6" />
              </div>
            ) : extensionTokens && extensionTokens.length > 0 ? (
              <div className="space-y-2">
                {extensionTokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                        <Key className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {token.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {token.deviceOs && <>{token.deviceOs} • </>}
                          {t("tokenCreated", {
                            date: new Date(token.createdAt).toLocaleDateString(
                              intl,
                            ),
                          })}
                          {token.lastUsedAt && (
                            <>
                              {" "}
                              •{" "}
                              {t("tokenLastUsed", {
                                date: new Date(
                                  token.lastUsedAt,
                                ).toLocaleDateString(intl),
                              })}
                            </>
                          )}
                          {token.usageCount !== null &&
                            token.usageCount > 0 && (
                              <>
                                {" "}
                                •{" "}
                                {t("tokenRequests", {
                                  count: token.usageCount,
                                })}
                              </>
                            )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeToken(token.id)}
                      disabled={revokeTokenMutation.isPending}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      title={t("revokeToken")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("noActiveTokens")}</p>
                <p className="text-xs mt-1">{t("generateATokenToConnect")}</p>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="mt-6 rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
            <h4 className="text-sm font-medium text-brand-800 dark:text-brand-200 mb-2">
              {t("howToUseTheExtension")}
            </h4>
            <ol className="text-sm text-brand-700 dark:text-brand-300 space-y-1 list-decimal list-inside">
              <li>
                Installer{" "}
                <a
                  href="https://chromewebstore.google.com/detail/omfnfamlmdfaobhcphdfhcnihcllekof"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-brand-900 dark:hover:text-brand-100"
                >
                  {t("timetrackExtensionFromTheChrome", { brand: brand.name })}
                </a>
              </li>
              <li>{t("generateAnApiTokenAbove")}</li>
              <li>{t("copyTheTokenAndPaste")}</li>
              <li>{t("youCanNowLogTime")}</li>
            </ol>
          </div>
        </div>

        {/* Sync History */}
        <SyncHistorySection
          syncHistory={syncHistory}
          isLoading={syncHistoryLoading}
        />

        {/* Alunta Klippekort Automation */}
        <AluntaKlippekortSection />

        {/* Help Section */}
        <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="h-6 w-6 shrink-0 text-tt-graa" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {t("needHelp")}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t("helpText", { brand: brand.name })}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href="https://www.billy.dk/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {t("billyDocumentation")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="https://api.dinero.dk/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {t("dineroDocumentation")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="https://restdocs.e-conomic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {t("eConomicDocumentation")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!revokeTokenConfirmId}
        onClose={() => setRevokeTokenConfirmId(null)}
        onConfirm={async () => {
          if (revokeTokenConfirmId) {
            await revokeTokenMutation.mutateAsync({
              tokenId: revokeTokenConfirmId,
            });
            setRevokeTokenConfirmId(null);
          }
        }}
        title={t("revokeToken")}
        description={t("areYouSureYouWant")}
        confirmLabel={t("revoke")}
        variant="danger"
        isLoading={revokeTokenMutation.isPending}
      />

      <ConfirmDialog
        isOpen={showDisconnectCalendarConfirm}
        onClose={() => setShowDisconnectCalendarConfirm(false)}
        onConfirm={() => {
          disconnectCalendarMutation.mutate();
          setShowDisconnectCalendarConfirm(false);
        }}
        title={t("disconnectGoogleCalendar")}
        description={t("areYouSureYouWant2")}
        confirmLabel={t("disconnect")}
        variant="danger"
        isLoading={disconnectCalendarMutation.isPending}
      />
    </>
  );
}

const RENEWAL_KEYS: Record<string, string> = {
  parallel: "renewalParallel",
  transfer: "renewalTransfer",
  archive: "renewalArchive",
};

// Alunta Klippekort section
function AluntaKlippekortSection() {
  const t = useTranslations("settingsIntegrations");
  const intl = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const { data: tokenData, isLoading: tokenLoading } =
    trpc.aluntaKlippekort.getToken.useQuery();

  const { data: mappings, isLoading: mappingsLoading } =
    trpc.aluntaKlippekort.listMappings.useQuery();

  const { data: recentWebhooks, isLoading: webhooksLoading } =
    trpc.aluntaKlippekort.getRecentWebhooks.useQuery();

  const regenerateTokenMutation =
    trpc.aluntaKlippekort.regenerateToken.useMutation({
      onSuccess: () => {
        utils.aluntaKlippekort.getToken.invalidate();
        setShowRegenerateConfirm(false);
        toast.success(t("webhookTokenRegenerated"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotRegenerateTheToken"));
      },
    });

  const handleCopyWebhookUrl = async () => {
    if (tokenData?.webhookUrl) {
      await navigator.clipboard.writeText(tokenData.webhookUrl);
      toast.success(t("copied"));
    }
  };

  return (
    <>
      <div
        id="alunta"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="mb-6 flex items-start gap-4">
          <div className="h-12 w-12 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
            <RefreshCw className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("aluntaPrepaidPackages")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("automaticCreationOfPrepaidPackages")}
            </p>
          </div>
        </div>

        {/* Webhook URL */}
        <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            {t("webhookUrl")}
          </h3>
          {tokenLoading ? (
            <div className="h-9 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          ) : (
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                readOnly
                value={tokenData?.webhookUrl ?? ""}
                aria-label={t("webhookUrl")}
                className="flex-1 min-w-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-900 dark:text-white font-mono select-all"
              />
              <button
                type="button"
                onClick={handleCopyWebhookUrl}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <Copy className="h-4 w-4" />
                {t("copy2")}
              </button>
              <button
                type="button"
                onClick={() => setShowRegenerateConfirm(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <RefreshCw className="h-4 w-4" />
                {t("regenerate")}
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("pasteThisUrlIntoAlunta")}
          </p>
        </div>

        {/* Mappings overview */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            {t("planMappings")}
          </h3>
          {mappingsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
                />
              ))}
            </div>
          ) : !mappings || mappings.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("noMappingsYetCreateA")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      {t("client")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      {t("plan")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-gray-400">
                      {t("hours")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      {t("behaviour")}
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600 dark:text-gray-400">
                      {t("status")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 text-gray-900 dark:text-white">
                        {m.client?.name ?? "–"}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">
                        {m.aluntaPlanName}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900 dark:text-white">
                        {m.hoursPerPeriod}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">
                        {RENEWAL_KEYS[m.renewalBehavior]
                          ? t(RENEWAL_KEYS[m.renewalBehavior])
                          : m.renewalBehavior}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            m.isActive
                              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                              : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          {m.isActive ? t("active") : t("paused")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent webhooks */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            {t("recentWebhooks")}
          </h3>
          {webhooksLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
                />
              ))}
            </div>
          ) : !recentWebhooks || recentWebhooks.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("noWebhookEventsReceivedYet")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {recentWebhooks.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex h-2 w-2 rounded-full ${
                        event.status === "success"
                          ? "bg-green-500"
                          : "bg-red-500"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {event.status === "success" ? t("success") : t("error")}
                    </span>
                    <span className="text-gray-900 dark:text-white font-mono text-xs">
                      {event.eventType}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(event.createdAt).toLocaleString(intl, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showRegenerateConfirm}
        onClose={() => setShowRegenerateConfirm(false)}
        onConfirm={() => regenerateTokenMutation.mutate()}
        title={t("regenerateWebhookToken")}
        description={t("theCurrentTokenIsPermanently")}
        confirmLabel={t("regenerate")}
        variant="danger"
        isLoading={regenerateTokenMutation.isPending}
      />
    </>
  );
}

// Integration card component
function IntegrationCard({
  name,
  description,
  logoColor,
  docsUrl,
  isConnected,
  isTesting,
  isSaving,
  onTest,
  onSave,
  children,
}: {
  name: string;
  description: string;
  logoColor: string;
  docsUrl: string;
  isConnected: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onTest: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("settingsIntegrations");
  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div
            className={`h-12 w-12 rounded-lg ${logoColor} flex items-center justify-center shrink-0`}
          >
            <span className="text-xl font-bold text-white">{name[0]}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {name}
              </h2>
              {isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-400">
                  <Check className="h-3 w-3" />
                  {t("connected")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          </div>
        </div>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="mb-6">{children}</div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isTesting ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("testing")}
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              {t("testConnection")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {t("saving")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t("save")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ----------- Calendar Matching Rules Section -----------
function MatchingRulesSection() {
  const t = useTranslations("settingsIntegrations");
  const utils = trpc.useUtils();
  const { data: rules, isLoading } = trpc.calendar.listMatchingRules.useQuery();
  const { data: allProjects } = trpc.projects.list.useQuery();
  const [newPattern, setNewPattern] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [showForm, setShowForm] = useState(false);

  const createRule = trpc.calendar.createMatchingRule.useMutation({
    onSuccess: () => {
      toast.success(t("matchingRuleCreated"));
      utils.calendar.listMatchingRules.invalidate();
      setNewPattern("");
      setNewProjectId("");
      setShowForm(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteRule = trpc.calendar.deleteMatchingRule.useMutation({
    onSuccess: () => {
      toast.success(t("ruleDeleted"));
      utils.calendar.listMatchingRules.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // biome-ignore lint/suspicious/noExplicitAny: Drizzle relation types vary
  const activeProjects = ((allProjects as any[]) || []).filter(
    (p) => p.status === "active",
  );

  const handleCreate = () => {
    if (!newPattern.trim() || !newProjectId) return;
    createRule.mutate({ pattern: newPattern.trim(), projectId: newProjectId });
  };

  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-lg bg-purple-500 flex items-center justify-center shrink-0">
            <Shuffle className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("matchingRules")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("defineRulesThatAutomaticallyMatch")}
            </p>
          </div>
        </div>
      </div>

      {/* Existing rules */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : rules && rules.length > 0 ? (
        <div className="mb-4 space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-2.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <code className="rounded bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 text-xs font-medium text-purple-800 dark:text-purple-300">
                  {rule.pattern}
                </code>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="truncate text-sm text-gray-700 dark:text-gray-300">
                  {rule.project
                    ? Array.isArray(rule.project)
                      ? rule.project[0]?.name
                      : rule.project.name
                    : t("noProject")}
                </span>
                {rule.matchCount > 0 && (
                  <span className="shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                    {t("matchCount", { count: rule.matchCount })}
                    {rule.matchCount !== 1 ? "es" : ""}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => deleteRule.mutate({ ruleId: rule.id })}
                disabled={deleteRule.isPending}
                className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("noMatchingRulesYetAdd")}
          </p>
        </div>
      )}

      {/* Add new rule */}
      {showForm ? (
        <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-4">
          <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">
            {t("newMatchingRule")}
          </p>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="matching-rule-pattern"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
              >
                {t("patternSearchedInTheEvent")}
              </label>
              <input
                id="matching-rule-pattern"
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder={t("eGStandupSprintReview")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
              />
            </div>
            <div>
              <label
                htmlFor="matching-rule-project"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
              >
                {t("project")}
              </label>
              <select
                id="matching-rule-project"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
              >
                <option value="">{t("chooseProject")}</option>
                {activeProjects.map(
                  (p: {
                    id: string;
                    name: string;
                    client?: { name: string };
                  }) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.client?.name ? ` (${p.client.name})` : ""}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={
                  createRule.isPending || !newPattern.trim() || !newProjectId
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {createRule.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {t("createRule")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setNewPattern("");
                  setNewProjectId("");
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:border-purple-400 hover:text-purple-600 dark:hover:border-purple-600 dark:hover:text-purple-400"
        >
          <Plus className="h-4 w-4" />
          {t("addMatchingRule")}
        </button>
      )}
    </div>
  );
}

// Grouped sync history section
function SyncHistorySection({
  syncHistory,
  isLoading,
}: {
  syncHistory: SyncLog[] | undefined;
  isLoading: boolean;
}) {
  const t = useTranslations("settingsIntegrations");
  const intl = toIntlLocale(useLocale());
  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="flex items-center justify-center py-8">
          <InlineSpinner className="h-6 w-6" />
        </div>
      </div>
    );
  }

  if (!syncHistory || syncHistory.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
            <Clock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("activityLog")}
          </h2>
        </div>
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          <p>{t("noActivityYet")}</p>
          <p className="mt-1 text-sm">{t("activityAppearsHereAsYou")}</p>
        </div>
      </div>
    );
  }

  // Group logs by date
  const grouped = new Map<string, SyncLog[]>();
  for (const log of syncHistory) {
    const date = new Date(log.createdAt);
    const key = date.toLocaleDateString(intl, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const existing = grouped.get(key) || [];
    existing.push(log);
    grouped.set(key, existing);
  }

  // Summary stats
  const totalSuccess = syncHistory.filter((l) => l.status === "success").length;
  const totalErrors = syncHistory.filter((l) => l.status === "error").length;
  const totalItems = syncHistory.reduce(
    (sum, l) => sum + (l.itemsProcessed ?? 0),
    0,
  );

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      {/* Header with summary stats */}
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
            <Clock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("activityLog")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("actionsTotal", { count: syncHistory.length })}
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-center">
            <p className="text-lg font-semibold text-green-700 dark:text-green-400">
              {totalSuccess}
            </p>
            <p className="text-xs text-green-600 dark:text-green-500">
              {t("completed")}
            </p>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-center">
            <p className="text-lg font-semibold text-red-700 dark:text-red-400">
              {totalErrors}
            </p>
            <p className="text-xs text-red-600 dark:text-red-500">
              {t("failed")}
            </p>
          </div>
          <div className="rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-3 text-center">
            <p className="text-lg font-semibold text-brand-700 dark:text-brand-400">
              {totalItems}
            </p>
            <p className="text-xs text-brand-600 dark:text-brand-400">
              {t("items")}
            </p>
          </div>
        </div>
      </div>

      {/* Grouped timeline */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {[...grouped.entries()].map(([dateLabel, logs]) => (
          <div key={dateLabel} className="p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {dateLabel}
            </p>
            <div className="space-y-2">
              {logs.map((log) => (
                <SyncLogItem key={log.id} log={log} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sync log item component
function SyncLogItem({ log }: { log: SyncLog }) {
  const t = useTranslations("settingsIntegrations");
  const intl = toIntlLocale(useLocale());
  const getStatusIcon = () => {
    switch (log.status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "partial":
        return <AlertCircle className="h-5 w-5 text-amber-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getOperationIcon = () => {
    if (log.operation.includes("export")) {
      return <ArrowUpFromLine className="h-4 w-4 text-gray-400" />;
    }
    return <ArrowDownToLine className="h-4 w-4 text-gray-400" />;
  };

  // Partnerbadges er neutrale med partnerens navn: farven er TimeTracks
  // ene brandfarve og må ikke ligne en partners (docs/BRAND.md → Ikoner).
  const getIntegrationColor = () =>
    "border border-tt-streg bg-tt-flade text-tt-blaek";

  const partnerName: Record<string, string> = {
    billy: "Billy",
    dinero: "Dinero",
    economic: "e-conomic",
  };

  const formatOperation = (op: string) => {
    const opMap: Record<string, string> = {
      export_client: t("opExportClient"),
      export_invoice: t("opExportInvoice"),
      import_contacts: t("opImportContacts"),
      sync_status: t("opSyncStatus"),
    };
    return opMap[op] || op;
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
      <div className="flex items-center gap-4">
        {getStatusIcon()}
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getIntegrationColor()}`}
            >
              {partnerName[log.integrationType] ?? log.integrationType}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {formatOperation(log.operation)}
            </span>
            {getOperationIcon()}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("logProcessed", { count: log.itemsProcessed ?? 0 })}
            {(log.itemsFailed ?? 0) > 0 &&
              `, ${t("logFailed", { count: log.itemsFailed ?? 0 })}`}
            {log.errorMessage && ` - ${log.errorMessage}`}
          </p>
        </div>
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {new Date(log.createdAt).toLocaleString(intl, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

// Billy Product Selector Component
function BillyProductSelector() {
  const t = useTranslations("settingsIntegrations");
  const utils = trpc.useUtils();
  const { data, isLoading, error } =
    trpc.integrations.getBillyProducts.useQuery();

  const { data: productMapping } =
    trpc.integrations.getBillyProductMapping.useQuery();

  const setDefaultProductMutation =
    trpc.integrations.setBillyDefaultProduct.useMutation({
      onSuccess: () => {
        toast.success(t("defaultProductSaved"));
        utils.integrations.getBillyProducts.invalidate();
        utils.integrations.getBillyProductMapping.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSaveTheProduct2"));
      },
    });

  const setKlippekortProductMutation =
    trpc.integrations.setBillyKlippekortProduct.useMutation({
      onSuccess: () => {
        toast.success(t("prepaidPackageProductSaved"));
        utils.integrations.getBillyProductMapping.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSaveThePrepaid"));
      },
    });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("productsLoadFailed", { message: error.message })}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <label
        htmlFor="billyProduct"
        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
      >
        {t("defaultProductForInvoiceLines")}
      </label>
      <select
        id="billyProduct"
        value={data?.defaultProductId || ""}
        onChange={(e) => {
          if (e.target.value) {
            setDefaultProductMutation.mutate({ productId: e.target.value });
          }
        }}
        disabled={setDefaultProductMutation.isPending}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
      >
        <option value="">{t("chooseAProduct")}</option>
        {data?.products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
            {product.productNo && ` (${product.productNo})`}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t("billyRequiresAProductOn")}
      </p>
      {data?.products.length === 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {t("youHaveNoProductsIn")}
        </p>
      )}

      {/* Klippekort product */}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <label
          htmlFor="billyKlippekortProduct"
          className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          {t("productForPrepaidPackageHours")}
        </label>
        <select
          id="billyKlippekortProduct"
          value={productMapping?.klippekortProductId || ""}
          onChange={(e) => {
            setKlippekortProductMutation.mutate({
              productId: e.target.value || null,
            });
          }}
          disabled={setKlippekortProductMutation.isPending}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
        >
          <option value="">{t("sameAsTheDefaultProduct")}</option>
          {data?.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {product.productNo && ` (${product.productNo})`}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("prepaidPackageTimeCanBe")}
        </p>
      </div>
    </div>
  );
}

// Default Integration Preferences Card
function DefaultIntegrationCard() {
  const t = useTranslations("settingsIntegrations");
  const { data: preferences, isLoading } =
    trpc.integrations.getDefaultIntegration.useQuery();

  const setDefaultMutation =
    trpc.integrations.setDefaultIntegration.useMutation({
      onSuccess: () => {
        toast.success(t("preferencesSaved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSaveThePreferences"));
      },
    });

  const batchSyncMutation =
    trpc.integrations.batchSyncInvoiceStatus.useMutation({
      onSuccess: (data) => {
        toast.success(
          t("batchSynced", { checked: data.checked, updated: data.updated }),
        );
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotSync"));
      },
    });

  const handleDefaultChange = (value: string) => {
    setDefaultMutation.mutate({
      integration:
        value === "none" ? null : (value as "billy" | "dinero" | "economic"),
    });
  };

  const handleAutoSyncChange = (enabled: boolean) => {
    setDefaultMutation.mutate({
      autoSync: enabled,
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  const integrationLabels: Record<string, string> = {
    billy: "Billy",
    dinero: "Dinero",
    economic: "e-conomic",
  };

  return (
    <div
      id="regnskab"
      className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
          <Link2 className="h-5 w-5 text-tt-graa" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("defaultAccountingSystem")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("chooseYourPreferredAccountingSystem")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Default Integration Dropdown */}
        <div>
          <label
            htmlFor="defaultIntegration"
            className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {t("defaultExportDestination")}
          </label>
          <select
            id="defaultIntegration"
            value={preferences?.defaultIntegration || "none"}
            onChange={(e) => handleDefaultChange(e.target.value)}
            disabled={setDefaultMutation.isPending}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
          >
            <option value="none">{t("noneChooseManuallyEachTime")}</option>
            {preferences?.availableIntegrations.map((integration) => (
              <option key={integration} value={integration}>
                {integrationLabels[integration] || integration}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("canBeOverriddenPerInvoice")}
          </p>
        </div>

        {/* Auto-sync Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {t("automaticStatusSync")}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("automaticallyMarkInvoicesAsPaid")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleAutoSyncChange(!preferences?.autoSync)}
            disabled={setDefaultMutation.isPending}
            role="switch"
            aria-checked={!!preferences?.autoSync}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus ${switchTrack(!!preferences?.autoSync)} disabled:opacity-50`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition-transform ${switchThumb(!!preferences?.autoSync)} ${
                preferences?.autoSync ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Manual Sync Button */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {t("manualSync")}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("checkThePaymentStatusOf")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => batchSyncMutation.mutate()}
            disabled={
              batchSyncMutation.isPending ||
              preferences?.availableIntegrations.length === 0
            }
            className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${batchSyncMutation.isPending ? "animate-spin" : ""}`}
            />
            {batchSyncMutation.isPending ? t("syncing2") : t("syncNow2")}
          </button>
        </div>
      </div>
    </div>
  );
}
