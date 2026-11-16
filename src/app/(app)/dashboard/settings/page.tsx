"use client";

import {
  AlertCircle,
  AlertTriangle,
  Check,
  ExternalLink,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { DayOffSettings } from "@/components/settings/DayOffSettings";
import { WorkScheduleSettings } from "@/components/settings/WorkScheduleSettings";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { Tooltip } from "@/components/ui/Tooltip";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useStartPageOptions } from "@/hooks/useStartPageOptions";
import {
  availableLocales,
  type Locale,
  localeOptionLabel,
} from "@/i18n/config";
import { signOut, useSession } from "@/lib/auth-client";
import { zodFieldValidator } from "@/lib/auto-save";
import {
  DEFAULT_START_PAGE,
  isKnownStartPage,
  type StartPageHref,
} from "@/lib/start-page";
import { storeProviderLabel } from "@/lib/store-billing/products";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { useTheme } from "@/providers/theme-provider";
import { trpc } from "@/providers/trpc-provider";

export default function SettingsPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settings");
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [storeAcknowledged, setStoreAcknowledged] = useState(false);

  const { data: userProfile, isLoading: profileLoading } =
    trpc.user.getProfile.useQuery();
  const utils = trpc.useUtils();
  // Ingen toasts her: kortenes statusfelt viser "Gemt", og useAutoSave
  // giver fejltoasten med "Prøv igen".
  const updateMutation = trpc.user.updateProfile.useMutation({
    onSuccess: (_data, input) => {
      utils.user.getProfile.invalidate();
      // Afrunding vises i tidslisterne, skjulte beløb på klippekortene
      if (input.roundingEnabled !== undefined) utils.time.invalidate();
      if (input.hidePrepaidValue !== undefined) utils.prepaid.invalidate();
    },
  });

  // Egen instans: mutate-callbacks kører kun for det seneste kald pr.
  // instans, og autogem-kortene deler updateMutation
  const imageMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => utils.user.getProfile.invalidate(),
  });

  const restartOnboardingMutation = trpc.onboarding.restart.useMutation({
    onSuccess: () => {
      // Guiden bor på sin egen side (#91). Fuld navigation i stedet for at
      // hente profilen igen her: ellers når timer-first-opstarten i
      // dashboard-skallen at gennemføre onboardingen, før siden skiftes.
      toast.success(t("onboardingRestarted"));
      window.location.assign("/dashboard/onboarding");
    },
    onError: (error) => {
      toast.error(error.message || t("onboardingRestartFailed"));
    },
  });

  const {
    data: deletionInfo,
    isLoading: deletionInfoLoading,
    isError: deletionInfoFailed,
    refetch: refetchDeletionInfo,
  } = trpc.user.getAccountDeletionInfo.useQuery(undefined, {
    enabled: showDeleteModal,
  });
  const storeSubscription = deletionInfo?.storeSubscription ?? null;
  // Eneste ejer af et team skal overdrage ejerskabet først (#918)
  const deletionBlocked = deletionInfo ? !deletionInfo.canDelete : false;
  const teamCount = deletionInfo?.teamCount ?? 0;
  const storeName = storeSubscription
    ? storeProviderLabel(storeSubscription.storeProvider)
    : null;

  const deleteMutation = trpc.user.deleteAccount.useMutation({
    onSuccess: async () => {
      toast.success(t("accountDeleted"));
      await signOut();
      router.push("/");
    },
    onError: (error) => {
      toast.error(error.message || t("accountDeleteFailed"));
    },
  });

  const [locale, setLocale] = useState("da");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  // Fyld sprog og billede første gang profilen er hentet (justering under
  // render i stedet for en effect)
  const [populated, setPopulated] = useState(false);
  if (userProfile && !populated) {
    setPopulated(true);
    setLocale(userProfile.locale || "da");
    setProfileImage(userProfile.image || null);
  }
  const startPageOptions = useStartPageOptions();

  const validateProfileField = useMemo(
    () =>
      zodFieldValidator<ProfileForm>({
        name: z
          .string()
          .trim()
          .min(2, t("profile.nameMin"))
          .max(255, t("profile.nameMax")),
        defaultHourlyRate: z
          .string()
          .max(20)
          .refine(
            (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0,
            t("profile.rateInvalid"),
          ),
        weeklyHourGoal: z
          .string()
          .refine(
            (v) => v !== "" && Number(v) >= 1 && Number(v) <= 80,
            t("profile.goalInvalid"),
          ),
      }),
    [t],
  );

  // Hvert kort gemmer sig selv; kun de ændrede felter sendes (useAutoSave)
  const profileForm = useAutoSave<ProfileForm>({
    defaults: PROFILE_DEFAULTS,
    server: userProfile ? toProfileForm(userProfile) : undefined,
    validate: validateProfileField,
    save: (patch, values) =>
      updateMutation.mutateAsync(toProfileInput(patch, values)),
  });
  const roundingForm = useAutoSave<RoundingForm>({
    defaults: ROUNDING_DEFAULTS,
    server: userProfile ? toRoundingForm(userProfile) : undefined,
    // De tre felter hænger sammen og sendes altid samlet
    save: (_patch, values) =>
      updateMutation.mutateAsync({
        roundingEnabled: values.roundingEnabled,
        roundingMinutes:
          values.roundingEnabled === true
            ? (Number.parseInt(values.roundingMinutes, 10) as
                | 5
                | 10
                | 15
                | 30
                | 60)
            : null,
        roundingMethod:
          values.roundingEnabled === true ? values.roundingMethod : null,
      }),
  });
  const prepaidForm = useAutoSave<PrepaidForm>({
    defaults: { hidePrepaidValue: false },
    server: userProfile
      ? { hidePrepaidValue: userProfile.hidePrepaidValue ?? false }
      : undefined,
    save: (patch) => updateMutation.mutateAsync(patch),
  });
  const approvalForm = useAutoSave<ApprovalForm>({
    defaults: { approvalWorkflow: "off" },
    server: userProfile
      ? {
          approvalWorkflow:
            (userProfile.approvalWorkflow as ApprovalForm["approvalWorkflow"]) ??
            "off",
        }
      : undefined,
    save: (patch) => updateMutation.mutateAsync(patch),
  });
  const { name, defaultHourlyRate, weeklyHourGoal, startPage } =
    profileForm.values;
  const { roundingEnabled, roundingMinutes, roundingMethod } =
    roundingForm.values;

  // Falder tilbage til /dashboard i selve selecten, hvis den lagrede værdi
  // ikke længere er tilgængelig (modul slået fra siden sidst, anden rolle).
  const effectiveStartPage: StartPageHref = startPageOptions.some(
    (o) => o.href === startPage,
  )
    ? startPage
    : DEFAULT_START_PAGE;

  const handleProfileImageChange = (url: string | null) => {
    if (!userProfile) return;
    const previous = profileImage;
    setProfileImage(url);
    imageMutation.mutate(
      { image: url },
      {
        onError: (error) => {
          setProfileImage(previous);
          toast.error(error.message || t("imageSaveFailed"));
        },
      },
    );
  };

  if (isPending || profileLoading) {
    return <LoadingScreen message={t("loading")} />;
  }

  if (!session) {
    return null;
  }

  const handleDeleteAccount = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmEmail !== session?.user.email) {
      toast.error(t("emailMismatch"));
      return;
    }

    await deleteMutation.mutateAsync({
      confirmEmail: deleteConfirmEmail,
      storeSubscriptionAcknowledged: storeAcknowledged,
    });
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
    setDeleteConfirmEmail("");
    setStoreAcknowledged(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4" data-tour="settings-page">
      {/* Header */}
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        helpTopicId="settings"
      />

      {/* Profile Picture */}
      <div
        id="profilbillede"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
          {t("profile.pictureTitle")}
        </h2>
        <ImageUpload
          value={profileImage}
          onChange={handleProfileImageChange}
          folder="profile"
          shape="circle"
          size={80}
          label={t("profile.pictureLabel")}
        />
      </div>

      {/* Profile Settings */}
      <form
        onSubmit={(e) => {
          // Enter gemmer med det samme i stedet for at vente på pausen
          e.preventDefault();
          profileForm.flush();
        }}
        className="space-y-4"
      >
        <div
          id="profil"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <CardTitle
            title={t("profile.detailsTitle")}
            status={profileForm.status}
            onRetry={profileForm.retry}
          />

          <div className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("profile.fullName")}
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) =>
                  profileForm.set("name", e.target.value, "debounce")
                }
                onBlur={profileForm.flush}
                aria-invalid={!!profileForm.errors.name}
                aria-describedby={
                  profileForm.errors.name ? "name-error" : undefined
                }
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
                placeholder={t("profile.namePlaceholder")}
              />
              <FieldError id="name-error" message={profileForm.errors.name} />
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("profile.email")}
              </label>
              <input
                id="email"
                type="email"
                value={userProfile?.email ?? ""}
                disabled
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
                placeholder={t("profile.emailPlaceholder")}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("profile.emailLocked")}
              </p>
            </div>

            <div>
              <label
                htmlFor="hourlyRate"
                className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("profile.hourlyRate")}
                <Tooltip
                  content={t("profile.hourlyRateTooltip")}
                  side="right"
                />
              </label>
              <input
                id="hourlyRate"
                type="number"
                value={defaultHourlyRate}
                onChange={(e) =>
                  profileForm.set(
                    "defaultHourlyRate",
                    e.target.value,
                    "debounce",
                  )
                }
                onBlur={profileForm.flush}
                aria-invalid={!!profileForm.errors.defaultHourlyRate}
                aria-describedby={
                  profileForm.errors.defaultHourlyRate
                    ? "hourlyRate-error hourlyRate-help"
                    : "hourlyRate-help"
                }
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
                placeholder="750"
              />
              <FieldError
                id="hourlyRate-error"
                message={profileForm.errors.defaultHourlyRate}
              />
              <p
                id="hourlyRate-help"
                className="mt-1 text-sm text-gray-500 dark:text-gray-400"
              >
                {t("profile.hourlyRateHelp")}
              </p>
            </div>

            <div>
              <label
                htmlFor="weeklyHourGoal"
                className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("profile.weeklyGoal")}
                <Tooltip
                  content={t("profile.weeklyGoalTooltip")}
                  side="right"
                />
              </label>
              <input
                id="weeklyHourGoal"
                type="number"
                step="0.5"
                min="1"
                max="80"
                value={weeklyHourGoal}
                onChange={(e) =>
                  profileForm.set("weeklyHourGoal", e.target.value, "debounce")
                }
                onBlur={profileForm.flush}
                aria-invalid={!!profileForm.errors.weeklyHourGoal}
                aria-describedby={
                  profileForm.errors.weeklyHourGoal
                    ? "weeklyHourGoal-error"
                    : undefined
                }
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
                placeholder="37"
              />
              <FieldError
                id="weeklyHourGoal-error"
                message={profileForm.errors.weeklyHourGoal}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("profile.weeklyGoalHelp")}
              </p>
            </div>

            <div>
              <label
                htmlFor="startPage"
                className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("profile.startPage")}
              </label>
              <select
                id="startPage"
                value={effectiveStartPage}
                onChange={(e) => {
                  if (isKnownStartPage(e.target.value)) {
                    profileForm.set("startPage", e.target.value, "now");
                  }
                }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/20 dark:focus:ring-blue-400/20"
              >
                {startPageOptions.map((option) => (
                  <option key={option.href} value={option.href}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("profile.startPageHelp")}
              </p>
            </div>
          </div>
        </div>
      </form>

      {/* Arbejdstid og dækningsgrad (#679) */}
      <WorkScheduleSettings />

      {/* Helligdage og fridage (#526) */}
      <div id="fridage" className="scroll-mt-20">
        <DayOffSettings />
      </div>

      {/* Time Rounding Settings */}
      <div
        id="afrunding"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <CardTitle
          title={t("rounding")}
          status={roundingForm.status}
          onRetry={roundingForm.retry}
          className="mb-2"
        />
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("roundingDescription")}
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={roundingEnabled === true}
              onChange={(e) =>
                roundingForm.set("roundingEnabled", e.target.checked, "now")
              }
              className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("roundingEnabled")}
            </span>
          </label>

          {roundingEnabled === true && (
            <div className="ml-7 space-y-4">
              <div>
                <label
                  htmlFor="roundingMinutes"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("roundingMinutes")}
                </label>
                <select
                  id="roundingMinutes"
                  value={roundingMinutes}
                  onChange={(e) =>
                    roundingForm.set("roundingMinutes", e.target.value, "now")
                  }
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
                >
                  <option value="5">{t("minutes", { count: 5 })}</option>
                  <option value="10">{t("minutes", { count: 10 })}</option>
                  <option value="15">{t("minutes", { count: 15 })}</option>
                  <option value="30">{t("minutes", { count: 30 })}</option>
                  <option value="60">{t("minutes", { count: 60 })}</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="roundingMethod"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("roundingMethod")}
                </label>
                <select
                  id="roundingMethod"
                  value={roundingMethod}
                  onChange={(e) =>
                    roundingForm.set(
                      "roundingMethod",
                      e.target.value as RoundingForm["roundingMethod"],
                      "now",
                    )
                  }
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:focus:ring-brand-400/20"
                >
                  <option value="up">{t("roundingUp")}</option>
                  <option value="nearest">{t("roundingNearest")}</option>
                  <option value="down">{t("roundingDown")}</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Klippekort: skjul beløb */}
      <div
        id="klippekort"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <CardTitle
          title={t("prepaid.title")}
          status={prepaidForm.status}
          onRetry={prepaidForm.retry}
          className="mb-2"
        />
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("prepaid.description")}
        </p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={prepaidForm.values.hidePrepaidValue}
            onChange={(e) =>
              prepaidForm.set("hidePrepaidValue", e.target.checked, "now")
            }
            className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("prepaid.hideAmounts")}
          </span>
        </label>
      </div>

      {/* Client Approval Workflow */}
      <div
        id="godkendelse"
        className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <CardTitle
          title={t("approval.title")}
          status={approvalForm.status}
          onRetry={approvalForm.retry}
        />
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("approval.description")}
        </p>
        <select
          aria-label={t("approval.title")}
          value={approvalForm.values.approvalWorkflow}
          onChange={(e) =>
            approvalForm.set(
              "approvalWorkflow",
              e.target.value as ApprovalForm["approvalWorkflow"],
              "now",
            )
          }
          className="mt-3 block w-64 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
        >
          <option value="off">{t("approval.off")}</option>
          <option value="per_entry">{t("approval.perEntry")}</option>
          <option value="per_period">{t("approval.perPeriod")}</option>
          <option value="per_invoice_draft">
            {t("approval.perInvoiceDraft")}
          </option>
        </select>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t("approval.override")}
        </p>
      </div>

      {/* Theme Settings */}
      <div
        id="udseende"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
          {t("appearance.title")}
        </h2>

        <div>
          <span className="mb-3 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("appearance.theme")}
          </span>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => {
                setTheme("light");
                toast.success(t("appearance.lightOn"));
              }}
              className={`flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                theme === "light"
                  ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                  : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
              }`}
            >
              <Sun
                className={`h-6 w-6 ${theme === "light" ? "text-brand-600" : "text-gray-600 dark:text-gray-400"}`}
              />
              <span
                className={`text-sm font-medium ${theme === "light" ? "text-brand-600" : "text-gray-900 dark:text-gray-300"}`}
              >
                {t("appearance.light")}
              </span>
              {theme === "light" && (
                <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme("dark");
                toast.success(t("appearance.darkOn"));
              }}
              className={`flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                theme === "dark"
                  ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                  : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
              }`}
            >
              <Moon
                className={`h-6 w-6 ${theme === "dark" ? "text-brand-600" : "text-gray-600 dark:text-gray-400"}`}
              />
              <span
                className={`text-sm font-medium ${theme === "dark" ? "text-brand-600" : "text-gray-900 dark:text-gray-300"}`}
              >
                {t("appearance.dark")}
              </span>
              {theme === "dark" && (
                <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme("system");
                toast.success(t("appearance.systemOn"));
              }}
              className={`flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-all ${
                theme === "system"
                  ? "border-brand-600 bg-brand-50 dark:bg-tt-gran-lys"
                  : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
              }`}
            >
              <div className="flex items-center gap-1">
                <Sun
                  className={`h-5 w-5 ${theme === "system" ? "text-brand-600" : "text-gray-600 dark:text-gray-400"}`}
                />
                <Moon
                  className={`h-5 w-5 ${theme === "system" ? "text-brand-600" : "text-gray-600 dark:text-gray-400"}`}
                />
              </div>
              <span
                className={`text-sm font-medium ${theme === "system" ? "text-brand-600" : "text-gray-900 dark:text-gray-300"}`}
              >
                {t("appearance.system")}
              </span>
              {theme === "system" && (
                <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              )}
            </button>
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            {t("appearance.help")}
          </p>
        </div>
      </div>

      {/* Sprog / Language */}
      <div
        id="sprog"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("language")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("languageDescription")}
        </p>
        <select
          value={locale}
          onChange={async (e) => {
            const newLocale = e.target.value;
            setLocale(newLocale);
            try {
              await updateMutation.mutateAsync({
                locale: newLocale as Locale,
              });
              // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API mangler i Safari/Firefox, og sproget skal ligge i cookien før reload
              document.cookie = `locale=${newLocale};path=/;max-age=31536000`;
              window.location.reload();
            } catch (error) {
              setLocale(userProfile?.locale || "da");
              toast.error(
                error instanceof Error && error.message
                  ? error.message
                  : t("languageChangeFailed"),
              );
            }
          }}
          className="mt-3 block w-48 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          {availableLocales().map((code) => (
            <option key={code} value={code} lang={code}>
              {localeOptionLabel(code)}
            </option>
          ))}
        </select>
      </div>

      {/* Onboarding */}
      <div
        id="opsaetningsguide"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t("onboarding.title")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("onboarding.description")}
        </p>
        <button
          type="button"
          onClick={() => restartOnboardingMutation.mutate()}
          disabled={restartOnboardingMutation.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {restartOnboardingMutation.isPending ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              {t("onboarding.restarting")}
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" />
              {t("onboarding.restart")}
            </>
          )}
        </button>
      </div>

      {/* Danger Zone */}
      <div
        id="slet-konto"
        className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-6"
      >
        <div className="flex items-start gap-4">
          <AlertCircle className="h-6 w-6 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("danger.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("danger.description")}
            </p>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-4 w-4" />
              {t("danger.deleteAccount")}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        title={t("deleteModal.title")}
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="text-sm text-red-800 dark:text-red-300">
              <p className="font-medium">{t("deleteModal.warning")}</p>
              <p className="mt-1">{t("deleteModal.intro")}</p>
              <ul className="mt-2 list-disc list-inside space-y-1">
                <li>{t("deleteModal.itemClientsProjects")}</li>
                <li>{t("deleteModal.itemEntries")}</li>
                <li>{t("deleteModal.itemPrepaid")}</li>
                <li>{t("deleteModal.itemInvoices")}</li>
                <li>{t("deleteModal.itemSettings")}</li>
              </ul>
              {teamCount > 0 && (
                <p className="mt-2">
                  {t("deleteModal.teams", { count: teamCount })}
                </p>
              )}
            </div>
          </div>

          {deletionBlocked && (
            <div
              role="alert"
              className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
            >
              <p className="font-medium">{t("deleteModal.transferTitle")}</p>
              <p className="mt-1">
                {t("deleteModal.transferBody", {
                  orgs:
                    deletionInfo?.blockingOrgs.map((o) => o.name).join(", ") ??
                    "",
                })}
              </p>
              <Link
                href="/dashboard/organization"
                className="mt-2 inline-flex items-center gap-1 font-medium underline"
              >
                {t("deleteModal.goToOrganisation")}
              </Link>
            </div>
          )}

          {deletionInfoFailed && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
            >
              <span>{t("deleteModal.storeCheckFailed")}</span>
              <button
                type="button"
                onClick={() => refetchDeletionInfo()}
                className="rounded-lg border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
              >
                {t("deleteModal.retry")}
              </button>
            </div>
          )}

          {storeSubscription && (
            <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
              <div className="text-sm text-yellow-800 dark:text-yellow-300">
                <p className="font-medium">
                  {t("deleteModal.storeTitle", { store: storeName ?? "" })}
                </p>
                <p className="mt-1">
                  {t("deleteModal.storeBody", {
                    brand: brand.name,
                    store: storeName ?? "",
                  })}
                </p>
                <a
                  href={storeSubscription.manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-medium underline"
                >
                  {t("deleteModal.cancelInStore", { store: storeName ?? "" })}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={storeAcknowledged}
                  onChange={(e) => setStoreAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("deleteModal.storeAck", { store: storeName ?? "" })}
                </span>
              </label>
            </div>
          )}

          <div>
            <label
              htmlFor="confirm-email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t.rich("deleteModal.confirmEmail", {
                email: session?.user.email ?? "",
                b: (chunks) => (
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {chunks}
                  </span>
                ),
              })}
            </label>
            <input
              id="confirm-email"
              type="email"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder={t("deleteModal.confirmPlaceholder")}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/20"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleCloseDeleteModal}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t("deleteModal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={
                deleteConfirmEmail !== session?.user.email ||
                deletionInfoLoading ||
                deletionInfoFailed ||
                deletionBlocked ||
                (!!storeSubscription && !storeAcknowledged) ||
                deleteMutation.isPending
              }
              className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleteMutation.isPending
                ? t("deleteModal.deleting")
                : t("deleteModal.deletePermanently")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type Profile = NonNullable<RouterOutputs["user"]["getProfile"]>;

type ProfileForm = {
  name: string;
  defaultHourlyRate: string;
  weeklyHourGoal: string;
  startPage: StartPageHref;
};
type RoundingForm = {
  roundingEnabled: boolean | null;
  roundingMinutes: string;
  roundingMethod: "up" | "nearest" | "down";
};
type PrepaidForm = { hidePrepaidValue: boolean };
type ApprovalForm = {
  approvalWorkflow: "off" | "per_entry" | "per_period" | "per_invoice_draft";
};

const PROFILE_DEFAULTS: ProfileForm = {
  name: "",
  defaultHourlyRate: "",
  weeklyHourGoal: "37",
  startPage: DEFAULT_START_PAGE,
};
const ROUNDING_DEFAULTS: RoundingForm = {
  roundingEnabled: null,
  roundingMinutes: "15",
  roundingMethod: "up",
};
function toProfileForm(p: Profile): ProfileForm {
  return {
    name: p.name || "",
    defaultHourlyRate: p.defaultHourlyRate || "",
    weeklyHourGoal: p.weeklyHourGoal || "37",
    startPage: isKnownStartPage(p.startPage) ? p.startPage : DEFAULT_START_PAGE,
  };
}
function toRoundingForm(p: Profile): RoundingForm {
  return {
    roundingEnabled: p.roundingEnabled ?? null,
    roundingMinutes: String(p.roundingMinutes ?? 15),
    roundingMethod:
      (p.roundingMethod as RoundingForm["roundingMethod"]) ?? "up",
  };
}
/** Kun de ændrede felter (tomme tal stoppes af valideringen). */
function toProfileInput(patch: Partial<ProfileForm>, values: ProfileForm) {
  return {
    ...(patch.name !== undefined ? { name: values.name.trim() } : {}),
    ...(patch.defaultHourlyRate !== undefined
      ? { defaultHourlyRate: patch.defaultHourlyRate }
      : {}),
    ...(patch.weeklyHourGoal !== undefined
      ? { weeklyHourGoal: patch.weeklyHourGoal }
      : {}),
    ...(patch.startPage !== undefined ? { startPage: patch.startPage } : {}),
  };
}

/** Kortets titel med autogem-status til højre. */
function CardTitle({
  title,
  status,
  onRetry,
  className = "mb-6",
}: {
  title: string;
  status: Parameters<typeof AutoSaveStatus>[0]["status"];
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>
      <AutoSaveStatus status={status} onRetry={onRetry} />
    </div>
  );
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      aria-live="polite"
      className="mt-1 text-sm text-red-600 dark:text-red-400"
    >
      {message}
    </p>
  );
}
