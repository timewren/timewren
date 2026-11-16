"use client";

import { Building2, CalendarClock, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard-nav";
import {
  AdminOnlyNotice,
  useCanManageOrgSettings,
} from "@/components/settings/AdminOnlyNotice";
import { DayOffCalendarEditor } from "@/components/settings/DayOffCalendarEditor";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useSession } from "@/lib/auth-client";
import type { AutoSaveStatus as SaveStatus } from "@/lib/auto-save";
import { zodFieldValidator } from "@/lib/auto-save";
import { trpc } from "@/providers/trpc-provider";

type CompanyTypeValue = "sole_prop" | "i_s" | "aps" | "as" | "freelance";
type VatPeriodValue = "monthly" | "quarterly" | "semi_annual" | "none";

type CompanyForm = {
  name: string;
  cvrNumber: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  bankRegNr: string;
  bankAccountNr: string;
  vatRegistered: boolean;
  vatNumber: string;
  logoUrl: string | null;
};
type CompanyInfoForm = {
  companyType: CompanyTypeValue | "";
  vatPeriod: VatPeriodValue | "";
  fiscalYearEnd: string;
  hasEmployees: boolean;
};
/** Kortene på siden, der deler virksomhedsprofilens ene mutation. */
type CompanyCard = "logo" | "info" | "adresse" | "bank" | "moms";

const COMPANY_DEFAULTS: CompanyForm = {
  name: "",
  cvrNumber: "",
  email: "",
  phone: "",
  address: "",
  postalCode: "",
  city: "",
  country: "Danmark",
  bankRegNr: "",
  bankAccountNr: "",
  vatRegistered: false,
  vatNumber: "",
  logoUrl: null,
};

export default function CompanySettingsPage() {
  const t = useTranslations("settingsCompany");
  // Samme krav som onboarding.updateCompanyProfile
  const validateCompanyField = useMemo(
    () =>
      zodFieldValidator<CompanyForm>({
        name: z.string().min(2, t("nameMin")),
        email: z.string().email(t("emailInvalid")),
      }),
    [t],
  );
  const { data: session, isPending: sessionPending } = useSession();
  // Medlemmer kan se profilen, men serveren afviser ændringer (orgAdmin)
  const canManage = useCanManageOrgSettings();
  const { data: profile, isLoading } =
    trpc.onboarding.getCompanyProfile.useQuery();
  const { data: userProfile } = trpc.user.getProfile.useQuery();
  const utils = trpc.useUtils();

  // Ingen succes-toasts: kortets statusfelt viser "Gemt"
  const updateMutation = trpc.onboarding.updateCompanyProfile.useMutation({
    onSuccess: () => {
      utils.onboarding.getCompanyProfile.invalidate();
    },
  });

  const updateCompanyInfoMutation = trpc.user.updateCompanyInfo.useMutation({
    onSuccess: () => {
      utils.user.getProfile.invalidate();
      utils.user.getUpcomingDeadlines.invalidate();
    },
  });

  // Uden profil udfyldes email fra kontoen, så vent også på sessionen
  // (og på at forespørgslen lykkedes: profile === undefined efter en fejl)
  const companyReady =
    !isLoading &&
    profile !== undefined &&
    !(profile === null && sessionPending);
  // Profilen gemmes samlet (navn og email er påkrævet), så den er atomisk:
  // intet sendes, mens navn eller email er ugyldig.
  const company = useAutoSave<CompanyForm>({
    defaults: COMPANY_DEFAULTS,
    server: !companyReady
      ? undefined
      : profile
        ? {
            name: profile.name || "",
            cvrNumber: profile.cvrNumber || "",
            email: profile.email || "",
            phone: profile.phone || "",
            address: profile.address || "",
            postalCode: profile.postalCode || "",
            city: profile.city || "",
            country: profile.country || "Danmark",
            bankRegNr: profile.bankRegNr || "",
            bankAccountNr: profile.bankAccountNr || "",
            vatRegistered: profile.vatRegistered || false,
            vatNumber: profile.vatNumber || "",
            logoUrl: profile.logoUrl || null,
          }
        : // Ingen profil endnu: email fra kontoen
          { ...COMPANY_DEFAULTS, email: session?.user?.email ?? "" },
    atomic: true,
    validate: validateCompanyField,
    errorTitle: t("saveFailed"),
    save: (_patch, v) =>
      updateMutation.mutateAsync({
        ...v,
        // Tomme felter sendes som "", så et ryddet felt også ryddes i DB
        logoUrl: v.logoUrl ?? "",
      }),
  });
  const companyInfo = useAutoSave<CompanyInfoForm>({
    defaults: {
      companyType: "",
      vatPeriod: "",
      fiscalYearEnd: "12-31",
      hasEmployees: false,
    },
    server: userProfile
      ? {
          companyType: (userProfile.companyType as CompanyTypeValue) || "",
          vatPeriod: (userProfile.vatPeriod as VatPeriodValue) || "",
          fiscalYearEnd: userProfile.fiscalYearEnd || "12-31",
          hasEmployees: userProfile.hasEmployees ?? false,
        }
      : undefined,
    errorTitle: t("saveTypeFailed"),
    // Typen og momsperioden er påkrævede felter i kaldet, så alle fire sendes
    save: (_patch, v) =>
      updateCompanyInfoMutation.mutateAsync({
        companyType: v.companyType || null,
        vatPeriod: v.vatPeriod || null,
        fiscalYearEnd: v.fiscalYearEnd || null,
        hasEmployees: v.hasEmployees,
      }),
  });
  const [isCvrLookupLoading, setIsCvrLookupLoading] = useState(false);
  // Statussen vises på det kort, der sidst blev ændret
  const [activeCard, setActiveCard] = useState<CompanyCard>("info");
  const cardStatus = (card: CompanyCard): SaveStatus =>
    activeCard === card ? company.status : "idle";
  // Navn og email er påkrævet; er de ugyldige, gemmes intet på siden. Det
  // vises på det ændrede kort og ved felterne under Grundlæggende.
  const companyBlocked = Object.keys(company.errors).length > 0;
  const cardBlocked = (card: CompanyCard) =>
    companyBlocked && (card === "info" || card === activeCard);
  const setCompany = <K extends keyof CompanyForm>(
    card: CompanyCard,
    key: K,
    value: CompanyForm[K],
    mode: "debounce" | "now" = "debounce",
  ) => {
    setActiveCard(card);
    company.set(key, value, mode);
  };
  const {
    name,
    cvrNumber,
    email,
    phone,
    address,
    postalCode,
    city,
    country,
    bankRegNr,
    bankAccountNr,
    vatRegistered,
    vatNumber,
    logoUrl,
  } = company.values;
  const { companyType, vatPeriod, fiscalYearEnd, hasEmployees } =
    companyInfo.values;

  const handleCvrLookup = async () => {
    if (!cvrNumber || cvrNumber.length < 8) {
      toast.error(t("cvrInvalid"));
      return;
    }

    setIsCvrLookupLoading(true);
    try {
      const response = await fetch(`/api/cvr?cvr=${cvrNumber}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("cvrLookupFailed"));
      }

      setActiveCard("info");
      company.setMany(
        {
          ...(data.name ? { name: data.name } : {}),
          ...(data.address ? { address: data.address } : {}),
          ...(data.postalCode ? { postalCode: data.postalCode } : {}),
          ...(data.city ? { city: data.city } : {}),
          ...(data.vatNumber
            ? { vatNumber: data.vatNumber, vatRegistered: true }
            : {}),
        },
        "now",
      );

      toast.success(t("cvrFetched"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("cvrFetchFailed"));
    } finally {
      setIsCvrLookupLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";
  const labelClass =
    "mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <AdminOnlyNotice>{t("adminOnly")}</AdminOnlyNotice>

      {/* Company Logo */}
      <div
        id="logo"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="mb-6 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("logoTitle")}
          </h2>
          <AutoSaveStatus
            status={cardStatus("logo")}
            blocked={cardBlocked("logo")}
            onRetry={company.retry}
          />
        </div>
        <fieldset disabled={!canManage || !companyReady}>
          <ImageUpload
            value={logoUrl}
            onChange={(url) => setCompany("logo", "logoUrl", url, "now")}
            folder="logos"
            shape="rectangle"
            size={80}
            label={t("logoLabel")}
          />
        </fieldset>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t("logoHelp")}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          company.flush();
        }}
        className="space-y-6"
      >
        {/* Medlemmer kan se, men ikke ændre (serveren kræver orgAdmin) */}
        <fieldset
          disabled={!canManage || !companyReady}
          className="min-w-0 space-y-6"
        >
          {/* Grundlæggende Info */}
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="mb-6 flex items-start justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <Building2 className="h-5 w-5" />
                {t("basicsTitle")}
              </h2>
              <AutoSaveStatus
                status={cardStatus("info")}
                onRetry={company.retry}
                blocked={cardBlocked("info")}
              />
            </div>

            <div className="space-y-4">
              {/* CVR Number with Lookup */}
              <div>
                <label htmlFor="cvrNumber" className={labelClass}>
                  {t("cvr")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="cvrNumber"
                    type="text"
                    value={cvrNumber}
                    onChange={(e) =>
                      setCompany(
                        "info",
                        "cvrNumber",
                        e.target.value.replace(/\D/g, ""),
                      )
                    }
                    onBlur={company.flush}
                    maxLength={8}
                    className={`flex-1 ${inputClass}`}
                    placeholder="12345678"
                  />
                  <button
                    type="button"
                    onClick={handleCvrLookup}
                    disabled={isCvrLookupLoading || !cvrNumber}
                    className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCvrLookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    {t("lookup")}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("lookupHelp")}
                </p>
              </div>

              {/* Company Name */}
              <div>
                <label htmlFor="companyName" className={labelClass}>
                  {t("companyName")} <span className="text-red-600">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  value={name}
                  onChange={(e) => setCompany("info", "name", e.target.value)}
                  onBlur={company.flush}
                  required
                  aria-invalid={!!company.errors.name}
                  aria-describedby={
                    company.errors.name ? "companyName-error" : undefined
                  }
                  className={inputClass}
                  placeholder={t("companyNamePlaceholder")}
                />
                {company.errors.name && (
                  <p
                    id="companyName-error"
                    aria-live="polite"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {company.errors.name}
                  </p>
                )}
              </div>

              {/* Contact Email */}
              <div>
                <label htmlFor="companyEmail" className={labelClass}>
                  {t("contactEmail")} <span className="text-red-600">*</span>
                </label>
                <input
                  id="companyEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setCompany("info", "email", e.target.value)}
                  onBlur={company.flush}
                  required
                  aria-invalid={!!company.errors.email}
                  aria-describedby={
                    company.errors.email ? "companyEmail-error" : undefined
                  }
                  className={inputClass}
                  placeholder={t("contactEmailPlaceholder")}
                />
                {company.errors.email && (
                  <p
                    id="companyEmail-error"
                    aria-live="polite"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {company.errors.email}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="companyPhone" className={labelClass}>
                  {t("phone")}
                </label>
                <input
                  id="companyPhone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setCompany("info", "phone", e.target.value)}
                  onBlur={company.flush}
                  className={inputClass}
                  placeholder="+45 12 34 56 78"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div
            id="adresse"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("addressTitle")}
              </h2>
              <AutoSaveStatus
                status={cardStatus("adresse")}
                onRetry={company.retry}
                blocked={cardBlocked("adresse")}
              />
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="companyAddress" className={labelClass}>
                  {t("addressTitle")}
                </label>
                <input
                  id="companyAddress"
                  type="text"
                  value={address}
                  onChange={(e) =>
                    setCompany("adresse", "address", e.target.value)
                  }
                  onBlur={company.flush}
                  className={inputClass}
                  placeholder={t("addressPlaceholder")}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="companyPostalCode" className={labelClass}>
                    {t("postalCode")}
                  </label>
                  <input
                    id="companyPostalCode"
                    type="text"
                    value={postalCode}
                    onChange={(e) =>
                      setCompany("adresse", "postalCode", e.target.value)
                    }
                    onBlur={company.flush}
                    className={inputClass}
                    placeholder="1000"
                  />
                </div>

                <div>
                  <label htmlFor="companyCity" className={labelClass}>
                    {t("city")}
                  </label>
                  <input
                    id="companyCity"
                    type="text"
                    value={city}
                    onChange={(e) =>
                      setCompany("adresse", "city", e.target.value)
                    }
                    onBlur={company.flush}
                    className={inputClass}
                    placeholder={t("cityPlaceholder")}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="companyCountry" className={labelClass}>
                  {t("country")}
                </label>
                <input
                  id="companyCountry"
                  type="text"
                  value={country}
                  onChange={(e) =>
                    setCompany("adresse", "country", e.target.value)
                  }
                  onBlur={company.flush}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Banking */}
          <div
            id="bank"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("bankTitle")}
              </h2>
              <AutoSaveStatus
                status={cardStatus("bank")}
                onRetry={company.retry}
                blocked={cardBlocked("bank")}
              />
            </div>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              {t("bankHelp")}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bankRegNr" className={labelClass}>
                  {t("bankReg")}
                </label>
                <input
                  id="bankRegNr"
                  type="text"
                  value={bankRegNr}
                  onChange={(e) =>
                    setCompany("bank", "bankRegNr", e.target.value)
                  }
                  onBlur={company.flush}
                  className={inputClass}
                  placeholder="1234"
                  maxLength={4}
                />
              </div>

              <div>
                <label htmlFor="bankAccountNr" className={labelClass}>
                  {t("bankAccount")}
                </label>
                <input
                  id="bankAccountNr"
                  type="text"
                  value={bankAccountNr}
                  onChange={(e) =>
                    setCompany("bank", "bankAccountNr", e.target.value)
                  }
                  onBlur={company.flush}
                  className={inputClass}
                  placeholder="1234567890"
                />
              </div>
            </div>
          </div>

          {/* VAT */}
          <div
            id="moms"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("vatTitle")}
              </h2>
              <AutoSaveStatus
                status={cardStatus("moms")}
                onRetry={company.retry}
                blocked={cardBlocked("moms")}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="vatRegistered"
                  checked={vatRegistered}
                  onChange={(e) =>
                    setCompany("moms", "vatRegistered", e.target.checked, "now")
                  }
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <label
                  htmlFor="vatRegistered"
                  className="cursor-pointer text-sm text-gray-700 dark:text-gray-300"
                >
                  {t("vatRegistered")}
                </label>
              </div>

              {vatRegistered && (
                <div>
                  <label htmlFor="vatNumber" className={labelClass}>
                    {t("vatNumber")}
                  </label>
                  <input
                    id="vatNumber"
                    type="text"
                    value={vatNumber}
                    onChange={(e) =>
                      setCompany("moms", "vatNumber", e.target.value)
                    }
                    onBlur={company.flush}
                    className={inputClass}
                    placeholder="DK12345678"
                  />
                </div>
              )}
            </div>
          </div>
        </fieldset>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Virksomhedstype og moms (for Vigtige datoer widget)                 */}
      {/* ------------------------------------------------------------------ */}
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <fieldset
          disabled={!canManage || !userProfile}
          className="min-w-0 space-y-6"
        >
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <CalendarClock className="h-5 w-5" />
                {t("typeTitle")}
              </h2>
              <AutoSaveStatus
                status={companyInfo.status}
                onRetry={companyInfo.retry}
              />
            </div>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              {t("typeHelp")}
            </p>

            <div className="space-y-6">
              {/* Virksomhedstype */}
              <div>
                <span className={labelClass}>{t("companyType")}</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { value: "sole_prop", label: t("typeSoleProp") },
                    { value: "i_s", label: t("typeIS") },
                    { value: "aps", label: t("typeAps") },
                    { value: "as", label: t("typeAs") },
                    { value: "freelance", label: t("typeFreelance") },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        companyType === opt.value
                          ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
                          : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="companyType"
                        value={opt.value}
                        checked={companyType === opt.value}
                        onChange={(e) =>
                          companyInfo.set(
                            "companyType",
                            e.target.value as CompanyTypeValue,
                            "now",
                          )
                        }
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Moms-periode */}
              <div>
                <span className={labelClass}>{t("vatPeriod")}</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { value: "monthly", label: t("periodMonthly") },
                    { value: "quarterly", label: t("periodQuarterly") },
                    { value: "semi_annual", label: t("periodSemiAnnual") },
                    { value: "none", label: t("periodNone") },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        vatPeriod === opt.value
                          ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
                          : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="vatPeriod"
                        value={opt.value}
                        checked={vatPeriod === opt.value}
                        onChange={(e) =>
                          companyInfo.set(
                            "vatPeriod",
                            e.target.value as VatPeriodValue,
                            "now",
                          )
                        }
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Regnskabsår slut — kun for ApS/A/S */}
              {(companyType === "aps" || companyType === "as") && (
                <div>
                  <label htmlFor="fiscalYearEnd" className={labelClass}>
                    {t("fiscalYearEnd")}
                  </label>
                  <select
                    id="fiscalYearEnd"
                    value={fiscalYearEnd}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        // Keep current custom value
                      } else {
                        companyInfo.set("fiscalYearEnd", e.target.value, "now");
                      }
                    }}
                    className={inputClass}
                  >
                    <option value="12-31">{t("fyDec")}</option>
                    <option value="06-30">{t("fyJun")}</option>
                    <option value="03-31">{t("fyMar")}</option>
                    <option value="09-30">{t("fySep")}</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("fiscalHelp")}
                  </p>
                </div>
              )}

              {/* Ansatte */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="hasEmployees"
                  checked={hasEmployees}
                  onChange={(e) =>
                    companyInfo.set("hasEmployees", e.target.checked, "now")
                  }
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <label
                  htmlFor="hasEmployees"
                  className="cursor-pointer text-sm text-gray-700 dark:text-gray-300"
                >
                  {t("hasEmployees")}
                  <span className="block text-xs text-gray-500 dark:text-gray-400 font-normal">
                    {t("hasEmployeesHelp")}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </fieldset>
      </form>

      {/* Helligdage og firmafridage for hele organisationen (#526) */}
      <div id="fridage" className="scroll-mt-20">
        <DayOffCalendarEditor
          scope={{ scope: "org" }}
          title={t("dayOffTitle")}
          description={t("dayOffDescription")}
        />
      </div>
    </div>
  );
}
