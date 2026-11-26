import { createElement } from "react";
import { DesktopLicenseEmail } from "@/components/email/DesktopLicenseEmail";
import { DESKTOP_LIFETIME_MAX_DEVICES, getAppUrl } from "@/lib/config";
import { brandFromLicenseKey } from "@/lib/desktop-license-brand";
import { mailT } from "@/lib/email/locale";
import { mailBrandFor } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { renderEmail } from "./render-email";

/**
 * Send the desktop license key to a buyer. Shared by the Stripe webhook (on
 * purchase) and the self-service "resend my key" flow.
 */
export async function sendLicenseKeyEmail(opts: {
  to: string;
  licenseKey: string;
  tier: string;
  name?: string | null;
  maxDevices?: number;
  /** Buyer's language when there is no profile (TimeWren checkout locale). */
  locale?: string | null;
}): Promise<void> {
  const { to, licenseKey, tier, name } = opts;
  // The key's prefix says whose licence it is: TimeWren buyers get a TimeWren
  // mail (sender, logo, texts), never a TimeTrack one.
  const mailBrand =
    brandFromLicenseKey(licenseKey) === "timewren"
      ? mailBrandFor("timewren")
      : undefined;

  if (!isMailAvailable()) {
    console.warn("[Desktop License] No mail transport set, skipping email");
    return;
  }

  const locale = await getRecipientLocale({
    email: to,
    fallback: opts.locale ?? mailBrand?.locale,
  });
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const appUrl = mailBrand?.siteUrl ?? getAppUrl();
  const tierLabel =
    tier === "lifetime" ? "Lifetime" : tier === "team" ? "Team" : "Solo";
  const maxDevices =
    opts.maxDevices ??
    (tier === "lifetime"
      ? DESKTOP_LIFETIME_MAX_DEVICES
      : tier === "team"
        ? 10
        : 2);
  const { html, text } = await renderEmail(
    createElement(DesktopLicenseEmail, {
      name,
      licenseKey,
      tierLabel,
      maxDevices,
      appUrl,
      locale,
      mailBrand,
    }),
  );

  try {
    const result = await resend.emails.send({
      from: mailBrand?.from ?? DEFAULT_FROM_EMAIL,
      to,
      subject: t("desktopLicense.subject", { tier: tierLabel }),
      html,
      text,
    });
    if (result.error) {
      console.error(
        "[Desktop License] Failed to send license email:",
        result.error,
      );
    }
  } catch (error) {
    console.error("[Desktop License] Email send error:", error);
  }
}
