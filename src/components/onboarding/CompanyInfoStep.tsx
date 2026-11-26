"use client";

import { ArrowLeft, Building2, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { decideVat } from "@/lib/invoices/vat-default";

interface CompanyInfoStepProps {
  onNext: (data: {
    name: string;
    cvrNumber?: string;
    email: string;
    phone?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    country: string;
    bankRegNr?: string;
    bankAccountNr?: string;
    /** Udeladt = brugeren har ikke valgt; serveren følger CVR-reglen. */
    vatRegistered?: boolean;
    vatNumber?: string;
    logoUrl?: string;
  }) => void;
  onBack: () => void;
  /** Vis "Spring over" — oplysningerne kan udfyldes senere under Indstillinger. */
  onSkip?: () => void;
  initialData?: {
    name?: string;
    cvrNumber?: string;
    email?: string;
    phone?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    bankRegNr?: string;
    bankAccountNr?: string;
    vatRegistered?: boolean;
    vatRegisteredChosen?: boolean;
    vatNumber?: string;
    logoUrl?: string;
  };
  userEmail?: string;
}

export function CompanyInfoStep({
  onNext,
  onBack,
  onSkip,
  initialData,
  userEmail,
}: CompanyInfoStepProps) {
  const t = useTranslations("onboarding.company");
  const [isLoading, setIsLoading] = useState(false);
  const [isCvrLookupLoading, setIsCvrLookupLoading] = useState(false);

  // Form state
  const [name, setName] = useState(initialData?.name || "");
  const [cvrNumber, setCvrNumber] = useState(initialData?.cvrNumber || "");
  const [email, setEmail] = useState(initialData?.email || userEmail || "");
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [address, setAddress] = useState(initialData?.address || "");
  const [postalCode, setPostalCode] = useState(initialData?.postalCode || "");
  const [city, setCity] = useState(initialData?.city || "");
  const [country, setCountry] = useState(initialData?.country || "Danmark");
  const [bankRegNr, setBankRegNr] = useState(initialData?.bankRegNr || "");
  const [bankAccountNr, setBankAccountNr] = useState(
    initialData?.bankAccountNr || "",
  );
  const [vatRegistered, setVatRegistered] = useState(
    initialData?.vatRegistered || false,
  );
  const [vatNumber, setVatNumber] = useState(initialData?.vatNumber || "");
  // Et dansk CVR slår "Jeg er momsregistreret" til, indtil brugeren selv har
  // valgt (her eller tidligere, gemt på profilen). Udregnes af de aktuelle
  // felter ved hver visning, så også et CVR fra en søgning tæller.
  const [vatChosen, setVatChosen] = useState(
    initialData?.vatRegisteredChosen ?? false,
  );
  const vatChecked = decideVat({
    chosen: vatChosen,
    stored: vatRegistered,
    cvrNumber,
    country,
  }).vatRegistered;

  const handleCvrLookup = async () => {
    if (!cvrNumber || cvrNumber.length < 2) {
      toast.error(t("cvrTooShort"));
      return;
    }

    setIsCvrLookupLoading(true);
    try {
      const response = await fetch(
        `/api/cvr?query=${encodeURIComponent(cvrNumber)}`,
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t("lookupFailed"));
      }

      // Auto-fill company info from CVR data
      if (data.name) setName(data.name);
      // Søgning på navn: feltet skal ende med virksomhedens CVR-nummer
      if (data.cvrNumber) setCvrNumber(data.cvrNumber);
      if (data.address) setAddress(data.address);
      if (data.postalCode) setPostalCode(data.postalCode);
      if (data.city) setCity(data.city);
      // Fluebenet følger CVR-reglen (vatChecked) eller brugerens valg
      if (data.vatNumber) setVatNumber(data.vatNumber);

      toast.success(t("lookupDone"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("lookupError"));
    } finally {
      setIsCvrLookupLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    onNext({
      name,
      cvrNumber: cvrNumber || undefined,
      email,
      phone: phone || undefined,
      address: address || undefined,
      postalCode: postalCode || undefined,
      city: city || undefined,
      country,
      bankRegNr: bankRegNr || undefined,
      bankAccountNr: bankAccountNr || undefined,
      // Kun brugerens eget valg sendes; ellers afgør serveren det efter
      // samme regel
      ...(vatChosen ? { vatRegistered } : {}),
      vatNumber: vatChecked && vatNumber ? vatNumber : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t("title")}</h2>
        <p className="mt-2 text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Progress Indicator */}
      <div className="text-sm text-gray-600">{t("stepOf")}</div>

      {/* Grundlæggende Info */}
      <div className="space-y-4 rounded-lg bg-gray-50 p-6">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Building2 className="h-5 w-5" />
          {t("basics")}
        </h3>

        {/* Company Search with Lookup */}
        <div>
          <label
            htmlFor="cvrNumber"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("searchLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="cvrNumber"
              type="text"
              value={cvrNumber}
              onChange={(e) => setCvrNumber(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder={t("searchPlaceholder")}
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
              {t("search")}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">{t("searchHint")}</p>
        </div>

        {/* Company Name */}
        <div>
          <label
            htmlFor="name"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("nameLabel")}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder={t("namePlaceholder")}
          />
        </div>

        {/* Contact Email */}
        <div>
          <label
            htmlFor="email"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder={t("emailPlaceholder")}
          />
        </div>

        {/* Phone */}
        <div>
          <label
            htmlFor="phone"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("phoneLabel")}
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder="+45 12 34 56 78"
          />
        </div>
      </div>

      {/* Address Section */}
      <div className="space-y-4 rounded-lg bg-gray-50 p-6">
        <h3 className="font-semibold text-gray-900">{t("addressSection")}</h3>

        <div>
          <label
            htmlFor="address"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("addressLabel")}
          </label>
          <input
            id="address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            placeholder={t("addressPlaceholder")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="postalCode"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t("postalLabel")}
            </label>
            <input
              id="postalCode"
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder="1000"
            />
          </div>

          <div>
            <label
              htmlFor="city"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t("cityLabel")}
            </label>
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder={t("cityPlaceholder")}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="country"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            {t("countryLabel")}
          </label>
          <input
            id="country"
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
        </div>
      </div>

      {/* Banking Section */}
      <div className="space-y-4 rounded-lg bg-gray-50 p-6">
        <h3 className="font-semibold text-gray-900">{t("bankSection")}</h3>
        <p className="text-sm text-gray-600">{t("bankHint")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="bankRegNr"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t("regLabel")}
            </label>
            <input
              id="bankRegNr"
              type="text"
              value={bankRegNr}
              onChange={(e) => setBankRegNr(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder="1234"
              maxLength={4}
            />
          </div>

          <div>
            <label
              htmlFor="bankAccountNr"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t("accountLabel")}
            </label>
            <input
              id="bankAccountNr"
              type="text"
              value={bankAccountNr}
              onChange={(e) => setBankAccountNr(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder="1234567890"
            />
          </div>
        </div>
      </div>

      {/* VAT Section */}
      <div className="space-y-4 rounded-lg bg-gray-50 p-6">
        <h3 className="font-semibold text-gray-900">{t("vatSection")}</h3>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="vatRegistered"
            checked={vatChecked}
            onChange={(e) => {
              setVatChosen(true);
              setVatRegistered(e.target.checked);
            }}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          <label
            htmlFor="vatRegistered"
            className="flex-1 cursor-pointer text-sm text-gray-700"
          >
            {t("vatRegistered")}
          </label>
        </div>

        {vatChecked && (
          <div>
            <label
              htmlFor="vatNumber"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t("vatNumberLabel")}
            </label>
            <input
              id="vatNumber"
              type="text"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
              placeholder="DK12345678"
            />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {t("skip")}
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 rounded-lg bg-tt-gran px-6 py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? t("saving") : t("saveContinue")}
        </button>
      </div>
    </form>
  );
}
