import { Building2, CreditCard, Hash, Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";

// Legally required invoice sender fields (bogføringsloven): own CVR + address,
// a payment instruction, and a sequential, gap-free numbering series. The number
// itself is assigned atomically by the backend at finalisation — this panel only
// configures the prefix and the next counter value.
interface InvoiceConfig {
  prefix: string;
  nextNumber: string;
  cvr: string;
  address: string;
  bankReg: string;
  bankKonto: string;
  mobilepay: string;
  paymentTerms: string;
  klippekortLowThreshold: string;
}

// Field → settings-table key. CVR/address reuse the shared `user_*` profile keys
// (also editable under Generelt); the rest are invoice-specific.
const SETTING_KEYS: Record<keyof InvoiceConfig, string> = {
  prefix: "invoice_number_prefix",
  nextNumber: "invoice_next_number",
  cvr: "user_cvr",
  address: "user_address",
  bankReg: "bank_reg",
  bankKonto: "bank_konto",
  mobilepay: "mobilepay_nr",
  paymentTerms: "payment_terms_days",
  klippekortLowThreshold: "klippekort_low_threshold_hours",
};

export function InvoiceSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<InvoiceConfig>({
    prefix: "",
    nextNumber: "",
    cvr: "",
    address: "",
    bankReg: "",
    bankKonto: "",
    mobilepay: "",
    paymentTerms: "",
    klippekortLowThreshold: "",
  });
  // `isError` er ikke kosmetik: feltet males i grønt, så uden denne markering viste
  // "Kunne ikke gemme" og "Kunne ikke slette" sig som en succes i emerald.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings =
          await tauriInvoke<{ key: string; value: string }[]>(
            "get_all_settings",
          );
        const map = new Map(settings.map((s) => [s.key, s.value]));
        setConfig({
          prefix: map.get(SETTING_KEYS.prefix) ?? "",
          nextNumber: map.get(SETTING_KEYS.nextNumber) ?? "1",
          cvr: map.get(SETTING_KEYS.cvr) ?? "",
          address: map.get(SETTING_KEYS.address) ?? "",
          bankReg: map.get(SETTING_KEYS.bankReg) ?? "",
          bankKonto: map.get(SETTING_KEYS.bankKonto) ?? "",
          mobilepay: map.get(SETTING_KEYS.mobilepay) ?? "",
          paymentTerms: map.get(SETTING_KEYS.paymentTerms) ?? "14",
          klippekortLowThreshold:
            map.get(SETTING_KEYS.klippekortLowThreshold) ?? "2",
        });
      } catch {
        // Settings not yet saved — keep defaults
      }
    }
    loadSettings();
  }, []);

  const saveSetting = useCallback(
    async (key: string, value: string) => {
      try {
        await tauriInvoke("set_setting", { key, value });
        setSaveStatus({ text: t("common.saved"), isError: false });
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus({ text: t("common.errorSaving"), isError: true });
        setTimeout(() => setSaveStatus(null), 3000);
      }
    },
    [t],
  );

  function handleChange(field: keyof InvoiceConfig, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  function handleBlur(field: keyof InvoiceConfig) {
    saveSetting(SETTING_KEYS[field], config[field]);
  }

  return (
    <div className="space-y-8">
      {/* Save indicator */}
      {saveStatus && (
        <div
          className={`fixed right-6 top-16 z-50 rounded-md bg-(--color-surface) border border-(--color-border) px-3 py-1.5 text-xs font-medium shadow-lg ${saveStatus.isError ? "text-red-400" : "text-emerald-400"}`}
        >
          {saveStatus.text}
        </div>
      )}

      <p className="text-xs text-(--color-text-muted)">
        {t("invoiceSettings.intro")}
      </p>

      {/* Numbering */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Hash size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("invoiceSettings.numberingTitle")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("invoiceSettings.numberingDescription")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("invoiceSettings.prefix")}
            value={config.prefix}
            onChange={(e) => handleChange("prefix", e.target.value)}
            onBlur={() => handleBlur("prefix")}
            placeholder="2026-"
          />
          <Input
            label={t("invoiceSettings.nextNumber")}
            value={config.nextNumber}
            onChange={(e) => handleChange("nextNumber", e.target.value)}
            onBlur={() => handleBlur("nextNumber")}
            placeholder="1"
            type="number"
            min="1"
          />
        </div>
      </section>

      {/* Company */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("invoiceSettings.companyTitle")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("invoiceSettings.companyDescription")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("projects.cvrNumber")}
            value={config.cvr}
            onChange={(e) => handleChange("cvr", e.target.value)}
            onBlur={() => handleBlur("cvr")}
            placeholder="12345678"
          />
          <div className="col-span-2">
            <Input
              label={t("settings.addressLabel")}
              value={config.address}
              onChange={(e) => handleChange("address", e.target.value)}
              onBlur={() => handleBlur("address")}
              placeholder={t("settings.addressPlaceholder")}
            />
          </div>
        </div>
      </section>

      {/* Payment */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("invoiceSettings.paymentTitle")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("invoiceSettings.paymentDescription")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("invoiceSettings.bankReg")}
            value={config.bankReg}
            onChange={(e) => handleChange("bankReg", e.target.value)}
            onBlur={() => handleBlur("bankReg")}
            placeholder="1234"
          />
          <Input
            label={t("invoiceSettings.bankKonto")}
            value={config.bankKonto}
            onChange={(e) => handleChange("bankKonto", e.target.value)}
            onBlur={() => handleBlur("bankKonto")}
            placeholder="1234567890"
          />
          <Input
            label={t("invoiceSettings.mobilepay")}
            value={config.mobilepay}
            onChange={(e) => handleChange("mobilepay", e.target.value)}
            onBlur={() => handleBlur("mobilepay")}
            placeholder="12345"
          />
          <div className="flex items-end gap-2">
            <Input
              label={t("invoiceSettings.paymentTerms")}
              value={config.paymentTerms}
              onChange={(e) => handleChange("paymentTerms", e.target.value)}
              onBlur={() => handleBlur("paymentTerms")}
              placeholder="14"
              type="number"
              min="0"
              className="w-24"
            />
            <span className="mb-2.5 text-sm text-(--color-text-muted)">
              {t("invoiceSettings.days")}
            </span>
          </div>
        </div>
      </section>

      {/* Klippekort low-balance alert */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Ticket size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("invoiceSettings.klippekortTitle")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("invoiceSettings.klippekortDescription")}
        </p>
        <div className="flex items-end gap-2">
          <Input
            label={t("invoiceSettings.klippekortThreshold")}
            value={config.klippekortLowThreshold}
            onChange={(e) =>
              handleChange("klippekortLowThreshold", e.target.value)
            }
            onBlur={() => handleBlur("klippekortLowThreshold")}
            placeholder="2"
            type="number"
            min="0"
            step="0.5"
            className="w-24"
          />
          <span className="mb-2.5 text-sm text-(--color-text-muted)">
            {t("invoiceSettings.hoursRemaining")}
          </span>
        </div>
      </section>
    </div>
  );
}
