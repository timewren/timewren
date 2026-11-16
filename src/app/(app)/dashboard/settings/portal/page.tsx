"use client";

import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Image,
  Loader2,
  Palette,
  RotateCcw,
  Type,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard-nav";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { SWITCH_PEER_TRACK } from "@/components/ui/switch-styles";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useSession } from "@/lib/auth-client";
import { zodFieldValidator } from "@/lib/auto-save";
import { DEFAULT_PORTAL_COLORS } from "@/lib/brand/tokens";
import { getMarketingUrl } from "@/lib/config";
import { trpc } from "@/providers/trpc-provider";

type BasicForm = {
  brandName: string;
  logoUrl: string;
  faviconUrl: string;
  footerText: string;
  supportEmail: string;
  supportPhone: string;
};
type ColorsForm = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
};
type FontsForm = { headingFont: string; bodyFont: string };
type FeaturesForm = {
  showInvoices: boolean;
  showProjects: boolean;
  showTimeEntries: boolean;
  showPrepaid: boolean;
};

const BASIC_DEFAULTS: BasicForm = {
  brandName: "",
  logoUrl: "",
  faviconUrl: "",
  footerText: "",
  supportEmail: "",
  supportPhone: "",
};
const COLOR_DEFAULTS: ColorsForm = { ...DEFAULT_PORTAL_COLORS };
const FEATURE_DEFAULTS: FeaturesForm = {
  showInvoices: true,
  showProjects: true,
  showTimeEntries: true,
  showPrepaid: true,
};

function toColorsForm(b: {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
}): ColorsForm {
  return {
    primaryColor: b.primaryColor || COLOR_DEFAULTS.primaryColor,
    secondaryColor: b.secondaryColor || COLOR_DEFAULTS.secondaryColor,
    accentColor: b.accentColor || COLOR_DEFAULTS.accentColor,
    backgroundColor: b.backgroundColor || COLOR_DEFAULTS.backgroundColor,
    textColor: b.textColor || COLOR_DEFAULTS.textColor,
  };
}

type Translator = ReturnType<typeof useTranslations>;

// Samme krav som portalBranding.updateBasic/updateColors; tomt felt = ryd
const optional = (schema: z.ZodString) => z.literal("").or(schema);
const makeBasicValidator = (t: Translator) =>
  zodFieldValidator<BasicForm>({
    brandName: z.string().max(255, t("theNameIsTooLong")),
    logoUrl: optional(z.string().url(t("enterAFullAddressE"))),
    faviconUrl: optional(z.string().url(t("enterAFullAddressE"))),
    footerText: z.string().max(1000, t("theTextCanBeAt")),
    supportEmail: optional(z.string().email(t("invalidEmailAddress"))),
    supportPhone: z.string().max(50, t("theNumberIsTooLong")),
  });
const makeColorValidator = (t: Translator) => {
  const hex = z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, t("enterTheColourAsRrggbb"));
  return zodFieldValidator<ColorsForm>({
    primaryColor: hex,
    secondaryColor: hex,
    accentColor: hex,
    backgroundColor: hex,
    textColor: hex,
  });
};

export default function PortalBrandingPage() {
  const t = useTranslations("settingsPortal");
  const validateBasicField = useMemo(() => makeBasicValidator(t), [t]);
  const validateColorField = useMemo(() => makeColorValidator(t), [t]);
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();

  // Fetch user profile (for role check)
  const { data: userProfile } = trpc.user.getProfile.useQuery();

  // Fetch branding data
  const { data: branding, isLoading } = trpc.portalBranding.get.useQuery();

  // Kortene gemmer selv; kun ændrede felter sendes (useAutoSave)
  const basicForm = useAutoSave<BasicForm>({
    defaults: BASIC_DEFAULTS,
    server: branding
      ? {
          brandName: branding.brandName || "",
          logoUrl: branding.logoUrl || "",
          faviconUrl: branding.faviconUrl || "",
          footerText: branding.footerText || "",
          supportEmail: branding.supportEmail || "",
          supportPhone: branding.supportPhone || "",
        }
      : undefined,
    validate: validateBasicField,
    errorTitle: t("couldNotSaveTheBranding"),
    save: (patch) =>
      updateBasicMutation.mutateAsync(
        Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [k, v || null]),
        ),
      ),
  });
  const colorsForm = useAutoSave<ColorsForm>({
    defaults: COLOR_DEFAULTS,
    server: branding ? toColorsForm(branding) : undefined,
    validate: validateColorField,
    errorTitle: t("couldNotSaveTheColours"),
    save: (patch) => updateColorsMutation.mutateAsync(patch),
  });
  const fontsForm = useAutoSave<FontsForm>({
    defaults: { headingFont: "Inter", bodyFont: "Inter" },
    server: branding
      ? {
          headingFont: branding.headingFont || "Inter",
          bodyFont: branding.bodyFont || "Inter",
        }
      : undefined,
    errorTitle: t("couldNotSaveTheFonts"),
    save: (patch) => updateFontsMutation.mutateAsync(patch),
  });
  const featuresForm = useAutoSave<FeaturesForm>({
    defaults: FEATURE_DEFAULTS,
    server: branding
      ? {
          showInvoices: branding.showInvoices ?? true,
          showProjects: branding.showProjects ?? true,
          showTimeEntries: branding.showTimeEntries ?? true,
          showPrepaid: branding.showPrepaid ?? true,
        }
      : undefined,
    errorTitle: t("couldNotSaveTheSettings"),
    save: (patch) => updateFeaturesMutation.mutateAsync(patch),
  });
  const {
    brandName,
    logoUrl,
    faviconUrl,
    footerText,
    supportEmail,
    supportPhone,
  } = basicForm.values;
  const {
    primaryColor,
    secondaryColor,
    accentColor,
    backgroundColor,
    textColor,
  } = colorsForm.values;
  const { headingFont, bodyFont } = fontsForm.values;
  const { showInvoices, showProjects, showTimeEntries, showPrepaid } =
    featuresForm.values;

  // Custom domain
  const [customDomain, setCustomDomain] = useState("");

  // Populate form when data loads
  useEffect(() => {
    if (branding) {
      setCustomDomain(branding.customDomain || "");
    }
  }, [branding]);

  // Mutations
  const updateBasicMutation = trpc.portalBranding.updateBasic.useMutation({
    onSuccess: () => {
      utils.portalBranding.get.invalidate();
    },
  });

  const updateColorsMutation = trpc.portalBranding.updateColors.useMutation({
    onSuccess: () => {
      utils.portalBranding.get.invalidate();
    },
  });

  const updateFontsMutation = trpc.portalBranding.updateFonts.useMutation({
    onSuccess: () => {
      utils.portalBranding.get.invalidate();
    },
  });

  const updateFeaturesMutation = trpc.portalBranding.updateFeatures.useMutation(
    {
      onSuccess: () => {
        utils.portalBranding.get.invalidate();
      },
    },
  );

  const resetColorsMutation = trpc.portalBranding.resetColors.useMutation({
    onSuccess: () => {
      utils.portalBranding.get.invalidate();
      colorsForm.reset(COLOR_DEFAULTS);
      toast.success(t("coloursResetToDefault"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotResetTheColours"));
    },
  });

  const setCustomDomainMutation =
    trpc.portalBranding.setCustomDomain.useMutation({
      onSuccess: (data) => {
        utils.portalBranding.get.invalidate();
        toast.success(t("domainAddedPleaseSetUp"));
        setDnsInstructions(data.verificationInstructions);
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotAddTheDomain"));
      },
    });

  const verifyDomainMutation =
    trpc.portalBranding.verifyCustomDomain.useMutation({
      onSuccess: () => {
        utils.portalBranding.get.invalidate();
        toast.success(t("domainVerified"));
        setDnsInstructions(null);
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotVerifyTheDomain"));
      },
    });

  const removeDomainMutation =
    trpc.portalBranding.removeCustomDomain.useMutation({
      onSuccess: () => {
        utils.portalBranding.get.invalidate();
        setCustomDomain("");
        toast.success(t("domainRemoved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotRemoveTheDomain"));
      },
    });

  const [dnsInstructions, setDnsInstructions] = useState<{
    txtRecord: { name: string; value: string };
    cnameRecord: { name: string; value: string };
  } | null>(null);

  if (isPending || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const handleSetDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDomain.trim()) return;
    await setCustomDomainMutation.mutateAsync({
      customDomain: customDomain.trim(),
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("copiedToClipboard"));
  };

  // Portal-links deles med eksterne kunder og skal pege på marketing-hosten
  // (/portal bor der efter subdomæne-splittet) — ikke på dashboardets host.
  const portalUrl = `${getMarketingUrl()}/portal`;

  const fontOptions = [
    "Inter",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Source Sans Pro",
    "Nunito",
    "Raleway",
    "Ubuntu",
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <PageHeader
        title={t("clientPortal")}
        description={t("yourClientPortalWithYour")}
      />

      {/* Preview Link */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 dark:border-brand-600 dark:bg-tt-gran-lys p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <div>
              <p className="font-medium text-brand-900 dark:text-brand-100">
                {t("yourPortalUrl")}
              </p>
              <p className="text-sm text-brand-700 dark:text-brand-300">
                {branding?.customDomainVerified && branding.customDomain
                  ? `https://${branding.customDomain}`
                  : portalUrl}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  branding?.customDomainVerified && branding.customDomain
                    ? `https://${branding.customDomain}`
                    : portalUrl,
                )
              }
              className="p-2 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-tt-gran-lys rounded-lg transition-colors"
            >
              <Copy className="h-4 w-4" />
            </button>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-tt-gran-lys rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Basic Branding */}
      <form
        id="branding"
        onSubmit={(e) => {
          e.preventDefault();
          basicForm.flush();
        }}
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Image className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-x-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("brandIdentity")}
              </h2>
              <AutoSaveStatus
                status={basicForm.status}
                onRetry={basicForm.retry}
              />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("logoNameAndContactDetails")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="brandName"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("brandName")}
              </label>
              <input
                id="brandName"
                type="text"
                value={brandName}
                onChange={(e) =>
                  basicForm.set("brandName", e.target.value, "debounce")
                }
                onBlur={basicForm.flush}
                aria-invalid={!!basicForm.errors.brandName}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("yourCompanyName")}
              />
              {basicForm.errors.brandName && (
                <p
                  role="alert"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {basicForm.errors.brandName}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="logoUrl"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("logoUrl")}
              </label>
              <input
                id="logoUrl"
                type="url"
                value={logoUrl}
                onChange={(e) =>
                  basicForm.set("logoUrl", e.target.value, "debounce")
                }
                onBlur={basicForm.flush}
                aria-invalid={!!basicForm.errors.logoUrl}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="https://example.com/logo.png"
              />
              {basicForm.errors.logoUrl && (
                <p
                  role="alert"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {basicForm.errors.logoUrl}
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="faviconUrl"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("faviconUrl")}
            </label>
            <input
              id="faviconUrl"
              type="url"
              value={faviconUrl}
              onChange={(e) =>
                basicForm.set("faviconUrl", e.target.value, "debounce")
              }
              onBlur={basicForm.flush}
              aria-invalid={!!basicForm.errors.faviconUrl}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder="https://example.com/favicon.ico"
            />
            {basicForm.errors.faviconUrl && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {basicForm.errors.faviconUrl}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="footerText"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("footerText")}
            </label>
            <textarea
              id="footerText"
              value={footerText}
              onChange={(e) =>
                basicForm.set("footerText", e.target.value, "debounce")
              }
              onBlur={basicForm.flush}
              aria-invalid={!!basicForm.errors.footerText}
              rows={2}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder={t("copyright2025YourCompanyAll")}
            />
            {basicForm.errors.footerText && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {basicForm.errors.footerText}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="supportEmail"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("supportEmail")}
              </label>
              <input
                id="supportEmail"
                type="email"
                value={supportEmail}
                onChange={(e) =>
                  basicForm.set("supportEmail", e.target.value, "debounce")
                }
                onBlur={basicForm.flush}
                aria-invalid={!!basicForm.errors.supportEmail}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={t("supportYourcompanyCom")}
              />
              {basicForm.errors.supportEmail && (
                <p
                  role="alert"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {basicForm.errors.supportEmail}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="supportPhone"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("supportPhone")}
              </label>
              <input
                id="supportPhone"
                type="tel"
                value={supportPhone}
                onChange={(e) =>
                  basicForm.set("supportPhone", e.target.value, "debounce")
                }
                onBlur={basicForm.flush}
                aria-invalid={!!basicForm.errors.supportPhone}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder="+45 12 34 56 78"
              />
              {basicForm.errors.supportPhone && (
                <p
                  role="alert"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {basicForm.errors.supportPhone}
                </p>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Colors */}
      <form
        id="farver"
        onSubmit={(e) => {
          e.preventDefault();
          colorsForm.flush();
        }}
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-100 dark:bg-pink-900/30">
              <Palette className="h-5 w-5 text-pink-600 dark:text-pink-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-x-3">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("colours")}
                </h2>
                <AutoSaveStatus
                  status={colorsForm.status}
                  onRetry={colorsForm.retry}
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("customiseThePortalSColour")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resetColorsMutation.mutate()}
            disabled={resetColorsMutation.isPending || colorsForm.busy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RotateCcw className="h-4 w-4" />
            {t("reset")}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label
              htmlFor="primaryColor"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("primaryColour")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="primaryColor"
                value={primaryColor}
                onChange={(e) =>
                  colorsForm.set("primaryColor", e.target.value, "now")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.primaryColor}
                className="h-10 w-14 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) =>
                  colorsForm.set("primaryColor", e.target.value, "debounce")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.primaryColor}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            {colorsForm.errors.primaryColor && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {colorsForm.errors.primaryColor}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="secondaryColor"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("secondaryColour")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="secondaryColor"
                value={secondaryColor}
                onChange={(e) =>
                  colorsForm.set("secondaryColor", e.target.value, "now")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.secondaryColor}
                className="h-10 w-14 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
              />
              <input
                type="text"
                value={secondaryColor}
                onChange={(e) =>
                  colorsForm.set("secondaryColor", e.target.value, "debounce")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.secondaryColor}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            {colorsForm.errors.secondaryColor && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {colorsForm.errors.secondaryColor}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="accentColor"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("accentColour")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="accentColor"
                value={accentColor}
                onChange={(e) =>
                  colorsForm.set("accentColor", e.target.value, "now")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.accentColor}
                className="h-10 w-14 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) =>
                  colorsForm.set("accentColor", e.target.value, "debounce")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.accentColor}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            {colorsForm.errors.accentColor && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {colorsForm.errors.accentColor}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="backgroundColor"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("backgroundColour")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="backgroundColor"
                value={backgroundColor}
                onChange={(e) =>
                  colorsForm.set("backgroundColor", e.target.value, "now")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.backgroundColor}
                className="h-10 w-14 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) =>
                  colorsForm.set("backgroundColor", e.target.value, "debounce")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.backgroundColor}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            {colorsForm.errors.backgroundColor && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {colorsForm.errors.backgroundColor}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="textColor"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("textColour")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="textColor"
                value={textColor}
                onChange={(e) =>
                  colorsForm.set("textColor", e.target.value, "now")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.textColor}
                className="h-10 w-14 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
              />
              <input
                type="text"
                value={textColor}
                onChange={(e) =>
                  colorsForm.set("textColor", e.target.value, "debounce")
                }
                disabled={resetColorsMutation.isPending}
                onBlur={colorsForm.flush}
                aria-invalid={!!colorsForm.errors.textColor}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              />
            </div>
            {colorsForm.errors.textColor && (
              <p
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {colorsForm.errors.textColor}
              </p>
            )}
          </div>
        </div>

        {/* Color Preview */}
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("preview")}
          </p>
          <div
            className="rounded-lg p-4"
            style={{ backgroundColor: backgroundColor }}
          >
            <div
              className="mb-2 text-sm font-semibold"
              style={{ color: textColor }}
            >
              {brandName || t("yourBrand")}
            </div>
            <p className="mb-4 text-sm" style={{ color: textColor }}>
              {t("thisIsAPreviewOf")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: primaryColor }}
              >
                {t("primaryButton")}
              </button>
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: secondaryColor }}
              >
                {t("secondaryButton")}
              </button>
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: accentColor }}
              >
                {t("accent")}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Fonts */}
      <form
        id="skrifttyper"
        onSubmit={(e) => {
          e.preventDefault();
          fontsForm.flush();
        }}
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
            <Type className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-x-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("fonts")}
              </h2>
              <AutoSaveStatus
                status={fontsForm.status}
                onRetry={fontsForm.retry}
              />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("chooseFontsForHeadingsAnd")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="headingFont"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("headingFont")}
            </label>
            <select
              id="headingFont"
              value={headingFont}
              onChange={(e) =>
                fontsForm.set("headingFont", e.target.value, "now")
              }
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              {fontOptions.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bodyFont"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("bodyFont")}
            </label>
            <select
              id="bodyFont"
              value={bodyFont}
              onChange={(e) => fontsForm.set("bodyFont", e.target.value, "now")}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              {fontOptions.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Font Preview */}
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3
            className="mb-2 text-xl font-bold text-gray-900 dark:text-white"
            style={{ fontFamily: headingFont }}
          >
            {t("previewHeading", { font: headingFont })}
          </h3>
          <p
            className="text-gray-600 dark:text-gray-400"
            style={{ fontFamily: bodyFont }}
          >
            {t("previewBody", { font: bodyFont })}
          </p>
        </div>
      </form>

      {/* Portal Features */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-x-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("portalContent")}
            </h2>
            <AutoSaveStatus
              status={featuresForm.status}
              onRetry={featuresForm.retry}
            />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("chooseWhatClientsCanSee")}
          </p>
        </div>

        <div className="space-y-4">
          <FeatureToggle
            label={t("invoices")}
            description={t("clientsCanViewAndDownload")}
            checked={showInvoices}
            onChange={(checked) =>
              featuresForm.set("showInvoices", checked, "now")
            }
          />
          <FeatureToggle
            label={t("projects")}
            description={t("clientsCanSeeTheStatus")}
            checked={showProjects}
            onChange={(checked) =>
              featuresForm.set("showProjects", checked, "now")
            }
          />
          <FeatureToggle
            label={t("timeEntries")}
            description={t("clientsCanSeeDetailedTime")}
            checked={showTimeEntries}
            onChange={(checked) =>
              featuresForm.set("showTimeEntries", checked, "now")
            }
          />
          <FeatureToggle
            label={t("prepaidPackages")}
            description={t("clientsCanSeeUsageOn")}
            checked={showPrepaid}
            onChange={(checked) =>
              featuresForm.set("showPrepaid", checked, "now")
            }
          />
        </div>
      </div>

      {/* Custom Domain — admin only */}
      {userProfile?.role === "admin" && (
        <div
          id="domaene"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
              <Globe className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("customDomain")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("useYourOwnDomainFor")}
              </p>
            </div>
          </div>

          {branding?.customDomainVerified ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      {branding.customDomain}
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      {t("domainVerifiedAndActive")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeDomainMutation.mutate()}
                  disabled={removeDomainMutation.isPending}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  {t("removeDomain")}
                </button>
              </div>
            </div>
          ) : branding?.customDomain ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">
                      {t("pendingVerification", {
                        domain: branding.customDomain,
                      })}
                    </p>
                    <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                      {t("setUpTheFollowingDns")}
                    </p>
                  </div>
                </div>
              </div>

              {dnsInstructions && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      {t("txtRecordVerification")}
                    </p>
                    <div className="flex items-center justify-between">
                      <code className="text-sm text-gray-900 dark:text-white">
                        {dnsInstructions.txtRecord.name} →{" "}
                        {dnsInstructions.txtRecord.value}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(dnsInstructions.txtRecord.value)
                        }
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      >
                        <Copy className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      {t("cnameRecord")}
                    </p>
                    <div className="flex items-center justify-between">
                      <code className="text-sm text-gray-900 dark:text-white">
                        {dnsInstructions.cnameRecord.name} →{" "}
                        {dnsInstructions.cnameRecord.value}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(dnsInstructions.cnameRecord.value)
                        }
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      >
                        <Copy className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-brand-50 dark:bg-tt-gran-lys border border-brand-200 dark:border-brand-600 p-3">
                <p className="text-sm text-brand-700 dark:text-brand-300">
                  {t.rich("dnsTip", {
                    b: (chunks) => <strong>{chunks}</strong>,
                    code: (chunks) => (
                      <code className="bg-brand-100 dark:bg-tt-gran-lys px-1 rounded">
                        {chunks}
                      </code>
                    ),
                  })}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => verifyDomainMutation.mutate()}
                  disabled={verifyDomainMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {verifyDomainMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {t("verifyDomain")}
                </button>
                <button
                  type="button"
                  onClick={() => removeDomainMutation.mutate()}
                  disabled={removeDomainMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSetDomain} className="space-y-4">
              <div>
                <label
                  htmlFor="customDomain"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("domain")}
                </label>
                <input
                  id="customDomain"
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("portalYourcompanyCom")}
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t("eGPortalYourcompanyCom")}
                </p>
              </div>
              <button
                type="submit"
                disabled={
                  setCustomDomainMutation.isPending || !customDomain.trim()
                }
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {setCustomDomainMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                {t("addDomain")}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// Toggle component for feature settings
function FeatureToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className={SWITCH_PEER_TRACK} />
      </label>
    </div>
  );
}
