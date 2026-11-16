import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { MAIL_FONT } from "@/components/email/brand";
import { DEFAULT_LOCALE, isAvailableLocale, type Locale } from "@/i18n/config";
import { runWithBrand, textBrandFromHeaders, tr } from "@/i18n/server-text";
import { getBrand } from "@/lib/brand";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { db } from "@/lib/db";
import { emailPreferences, users } from "@/lib/db/schema";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { appUrlEnv } from "@/lib/runtime-env";

// Marketing/lifecycle categories disabled by a one-click unsubscribe. Security
// and account-critical emails (password reset, login alerts, 2FA, invoices…)
// are intentionally NOT touched.
const MARKETING_OPT_OUT = {
  weeklyReport: false,
  monthlyReport: false,
  unbilledReminder: false,
  tipsAndTricks: false,
  productUpdates: false,
  dripEmails: false,
  onboardingMilestones: false,
  inactivityReminder: false,
} as const;

async function unsubscribeUser(token: string): Promise<boolean> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, resendContactId: true },
  });
  if (!user) return false;

  const existing = await db.query.emailPreferences.findFirst({
    where: eq(emailPreferences.userId, userId),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(emailPreferences)
      .set({ ...MARKETING_OPT_OUT, updatedAt: new Date() })
      .where(eq(emailPreferences.id, existing.id));
  } else {
    await db.insert(emailPreferences).values({ userId, ...MARKETING_OPT_OUT });
  }

  // Best-effort sync of unsubscribe status to the Resend audience.
  try {
    if (user.resendContactId) {
      const { updateContactSubscription } = await import(
        "@/lib/resend-contacts"
      );
      await updateContactSubscription(user.resendContactId, true);
    }
  } catch (err) {
    console.error("[Unsubscribe] Failed to sync to Resend:", err);
  }

  return true;
}

// Empty fallback yields a same-origin relative URL ("/dashboard/...") which is
// valid on this page even if NEXT_PUBLIC_APP_URL is unset.
const settingsUrl = `${appUrlEnv() ?? ""}/dashboard/settings/notifications`;

/**
 * Sidens brand. Afmeldingslinket i en TimeWren-mail peger på TimeWrens host,
 * så siden følger hosten (navn, ikon, link til indstillinger og teksterne via
 * runWithBrand). TimeTrack og uden multibrand: som før.
 */
interface PageBrand {
  name: string;
  icon: string;
  settingsUrl: string;
}
const TIMETRACK_PAGE: PageBrand = {
  name: "TimeTrack",
  icon: "/brand/tt-ikon-64.png",
  settingsUrl,
};
function pageBrandFor(request: NextRequest): PageBrand {
  const key = textBrandFromHeaders(request.headers);
  if (!key) return TIMETRACK_PAGE;
  return {
    name: getBrand(key).name,
    icon: "/brand/timewren/mark-64.png",
    settingsUrl: "/dashboard/settings/notifications",
  };
}

const T = BRAND_LIGHT;
const button = `display:inline-block;margin-top:16px;padding:12px 20px;background:${T.gran};color:${T.paaGran};text-decoration:none;border:0;border-radius:8px;font:600 15px/20px ${MAIL_FONT.replace(/"/g, "'")};cursor:pointer;`;

function page(
  title: string,
  bodyHtml: string,
  status: number,
  locale: string,
  brand: PageBrand,
): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}, ${brand.name}</title></head>
<body style="font-family:${MAIL_FONT.replace(/"/g, "'")};background:${T.flade};color:${T.blaek};margin:0;padding:48px 16px;">
<div style="max-width:480px;margin:0 auto;background:${T.papir};border:1px solid ${T.streg};border-radius:14px;padding:32px;">
<img src="${brand.icon}" width="32" height="32" alt="${brand.name}" style="display:block;margin:0 0 20px;">
<h1 style="color:${T.blaek};font-size:22px;line-height:28px;margin:0 0 12px;">${title}</h1>
${bodyHtml}
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const p = (text: string) =>
  `<p style="color:${T.graa};font-size:16px;line-height:1.6;margin:0;">${text}</p>`;

/** Sproget: modtagerens (via tokenet), ellers forespørgslens. */
async function pageLocale(token: string | null): Promise<Locale> {
  const userId = token ? verifyUnsubscribeToken(token) : null;
  if (userId) return getRecipientLocale({ userId });
  const requestLocale = await getLocale();
  return isAvailableLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
}

const settingsButton = (label: string, brand: PageBrand) =>
  `<a href="${brand.settingsUrl}" style="${button}">${label}</a>`;

async function successBody(locale: Locale, brand: PageBrand) {
  return `${p(await tr("serverMisc", "unsubscribe.successText", undefined, locale))}
${settingsButton(await tr("serverMisc", "unsubscribe.settingsButton", undefined, locale), brand)}`;
}

async function invalidBody(locale: Locale, brand: PageBrand) {
  return `${p(await tr("serverMisc", "unsubscribe.invalidText", undefined, locale))}
${settingsButton(await tr("serverMisc", "unsubscribe.settingsButton", undefined, locale), brand)}`;
}

async function confirmBody(token: string, locale: Locale) {
  return `${p(await tr("serverMisc", "unsubscribe.confirmText", undefined, locale))}
<form method="POST" action="/api/unsubscribe?token=${encodeURIComponent(token)}" style="margin:0;">
<button type="submit" style="${button}">${await tr("serverMisc", "unsubscribe.confirmButton", undefined, locale)}</button>
</form>`;
}

/**
 * One-click unsubscribe (RFC 8058). Mail clients that honor
 * List-Unsubscribe-Post send a POST here and we apply the opt-out immediately.
 */
export function POST(request: NextRequest) {
  return runWithBrand(textBrandFromHeaders(request.headers), () =>
    unsubscribePost(request),
  );
}

async function unsubscribePost(request: NextRequest) {
  const brand = pageBrandFor(request);
  const token = request.nextUrl.searchParams.get("token");
  const locale = await pageLocale(token);
  const ok = token ? await unsubscribeUser(token) : false;
  // Return HTML so a browser form-submit shows confirmation; RFC one-click
  // clients ignore the body and only look at the 200 status.
  return ok
    ? page(
        await tr("serverMisc", "unsubscribe.doneTitle", undefined, locale),
        await successBody(locale, brand),
        200,
        locale,
        brand,
      )
    : page(
        await tr("serverMisc", "unsubscribe.invalidTitle", undefined, locale),
        await invalidBody(locale, brand),
        400,
        locale,
        brand,
      );
}

/**
 * Visible unsubscribe link in the email body. A GET must NOT mutate state
 * (link prefetchers / security scanners follow GET links), so we only render
 * a confirmation page whose button POSTs to perform the opt-out.
 */
export function GET(request: NextRequest) {
  return runWithBrand(textBrandFromHeaders(request.headers), () =>
    unsubscribeGet(request),
  );
}

async function unsubscribeGet(request: NextRequest) {
  const brand = pageBrandFor(request);
  const token = request.nextUrl.searchParams.get("token");
  const locale = await pageLocale(token);
  const valid = token ? verifyUnsubscribeToken(token) !== null : false;
  return valid && token
    ? page(
        await tr("serverMisc", "unsubscribe.confirmTitle", undefined, locale),
        await confirmBody(token, locale),
        200,
        locale,
        brand,
      )
    : page(
        await tr("serverMisc", "unsubscribe.invalidTitle", undefined, locale),
        await invalidBody(locale, brand),
        400,
        locale,
        brand,
      );
}
