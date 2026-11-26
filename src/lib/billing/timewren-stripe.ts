import type Stripe from "stripe";
import { isHostAuthEnabled } from "@/lib/auth/host-auth";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import type { BrandKey } from "@/lib/brands/registry";
import {
  clampSeats,
  includedSeatsForTier,
  maxSeatsForTier,
} from "@/lib/config";
import { isDemoMode } from "@/lib/demo/demo-mode";

/**
 * Betaling på TimeWren Cloud med Stripe i EUR (Mads 17/11-2026, docs/specs/
 * timewren-cloud.md → "Betaling på TimeWren"). Rene funktioner uden db og
 * netværk, så parametre og mapping kan testes. TimeTrack betaler fortsat via
 * Alunta; intet her bruges for timetrack-konti.
 */

export const TIMEWREN_STRIPE_BRAND = "timewren" as const;

export type TimewrenPaidTier = "privat" | "solo" | "team" | "business";

export const TIMEWREN_PAID_TIERS: readonly TimewrenPaidTier[] = [
  "privat",
  "solo",
  "team",
  "business",
];

/**
 * Priserne slås op i Stripe på lookup_key, så price-id'er ikke står i koden.
 * Priserne er oprettet i Stripe (månedlige, EUR, tax_behavior exclusive,
 * metadata brand=timewren og plan_tier).
 */
export const TIMEWREN_LOOKUP_KEYS: Record<TimewrenPaidTier, string> = {
  privat: "timewren_privat_monthly_eur",
  solo: "timewren_solo_monthly_eur",
  team: "timewren_team_monthly_eur",
  business: "timewren_business_monthly_eur",
};

/**
 * Desktop-livstidslicensen (engangskøb i EUR). Slås op på lookup_key som
 * Cloud-priserne; prisen skal være engangs, EUR og
 * TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR (se timewrenDesktopPrice).
 */
export const TIMEWREN_DESKTOP_LOOKUP_KEY = "timewren_desktop_lifetime_eur";

/**
 * Metadata-nøglen på desktop-checkout'en. Bevidst IKKE `brand`: events med
 * metadata.brand går til Cloud-handleren (eventBrand), og licensen skal
 * udstedes af desktop-vejen i webhooken.
 */
export const DESKTOP_BRAND_METADATA_KEY = "desktop_brand";

/** Prøveperiode ved første checkout. Privat har ingen. */
export const TIMEWREN_TRIAL_DAYS = 14;

export function isPerSeatTier(tier: string): boolean {
  return tier === "team" || tier === "business";
}

export function isTimewrenPaidTier(
  value: string | null | undefined,
): value is TimewrenPaidTier {
  return TIMEWREN_PAID_TIERS.includes(value as TimewrenPaidTier);
}

/**
 * Stripe-betaling er slået til for TimeWren: nøglen er sat, og begge
 * host-auth-flag er til (ellers findes der ingen TimeWren-konti). Selvhost
 * uden STRIPE_SECRET_KEY eller med MULTIBRAND_ENABLED slået fra: aldrig.
 */
export function isTimewrenStripeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (isDemoMode(env)) return false;
  return !!env.STRIPE_SECRET_KEY?.trim() && isHostAuthEnabled();
}

/** Betaler brandet med Stripe (kun TimeWren, kun når slået til)? */
export function isStripeBillingBrand(brand: BrandKey): boolean {
  return brand === TIMEWREN_STRIPE_BRAND && isTimewrenStripeEnabled();
}

/**
 * Antal sæder, der købes: planer pr. bruger mindst det inkluderede antal og
 * de pladser, der allerede er i brug, højst tierens loft. Øvrige planer: 1.
 */
export function checkoutQuantity(
  tier: TimewrenPaidTier,
  requested: number | undefined,
  seatsInUse: number,
): number {
  if (!isPerSeatTier(tier)) return 1;
  const wanted = Math.max(requested ?? includedSeatsForTier(tier), seatsInUse);
  return clampSeats(tier, wanted);
}

export interface TimewrenCheckoutInput {
  tier: TimewrenPaidTier;
  priceId: string;
  quantity: number;
  customerId: string;
  organizationId: string;
  userId: string;
  /** Brandets app-URL, fx https://timewren.com (aldrig timetrack.dk). */
  appUrl: string;
  /** Prøveperiode: kun første abonnement og ikke Privat. */
  withTrial: boolean;
  /** Hvor kunden lander efter betaling; standard abonnementssiden. */
  returnPath?: string;
  locale?: string;
}

const STRIPE_LOCALES = new Set(["da", "de", "en", "es"]);

export function timewrenCheckoutParams(
  input: TimewrenCheckoutInput,
): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    brand: TIMEWREN_STRIPE_BRAND,
    organizationId: input.organizationId,
    userId: input.userId,
    planTier: input.tier,
  };
  const base = input.appUrl.replace(/\/+$/, "");
  const path = safeReturnPath(input.returnPath);
  const sep = path.includes("?") ? "&" : "?";
  const trial =
    input.withTrial && input.tier !== "privat"
      ? { trial_period_days: TIMEWREN_TRIAL_DAYS }
      : {};
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.organizationId,
    line_items: [{ price: input.priceId, quantity: input.quantity }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    allow_promotion_codes: true,
    // The Stripe account is named after TimeTrack; Checkout shows TimeWren.
    branding_settings: { display_name: "TimeWren" },
    metadata,
    subscription_data: { metadata, ...trial },
    success_url: `${base}${path}${sep}success=true`,
    cancel_url: `${base}${path}${sep}canceled=true`,
    ...(input.locale && STRIPE_LOCALES.has(input.locale)
      ? { locale: input.locale as Stripe.Checkout.SessionCreateParams.Locale }
      : {}),
  };
}

/** Kun relative stier i appen; alt andet giver abonnementssiden. */
export function safeReturnPath(path: string | undefined): string {
  const fallback = "/dashboard/settings/subscription";
  if (!path) return fallback;
  if (!path.startsWith("/dashboard") || path.startsWith("//")) return fallback;
  return path;
}

/** Tieren for en Stripe-pris. Kun TimeWren-priser (metadata brand) tæller. */
export function tierFromPrice(
  price: Pick<Stripe.Price, "lookup_key" | "metadata"> | null | undefined,
): TimewrenPaidTier | null {
  if (!price) return null;
  for (const tier of TIMEWREN_PAID_TIERS) {
    if (price.lookup_key === TIMEWREN_LOOKUP_KEYS[tier]) return tier;
  }
  if (price.metadata?.brand !== TIMEWREN_STRIPE_BRAND) return null;
  const t = price.metadata?.plan_tier;
  return isTimewrenPaidTier(t) ? t : null;
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function date(sec: number | null | undefined): Date | null {
  return typeof sec === "number" ? new Date(sec * 1000) : null;
}

/** Pladser, et abonnement giver ud fra det betalte antal. */
export function paidSeats(tier: TimewrenPaidTier, quantity: number): number {
  if (!isPerSeatTier(tier)) return 1;
  return Math.min(maxSeatsForTier(tier), Math.max(1, Math.round(quantity)));
}

export interface SubscriptionRowState {
  status: string;
  pastDueSince: Date | null;
  trialEndsAt: Date;
}

/**
 * Felterne i `subscriptions`, et Stripe-abonnement giver. null = rør ikke
 * tier/status (fx `incomplete`: betalingen er ikke gennemført endnu, kun
 * Stripe-id'erne gemmes). Opsagte og udløbne abonnementer lander på Gratis
 * som opsagte Alunta-kunder (FREE_TIER_SUBSCRIPTION_FIELDS).
 */
export function subscriptionFieldsFromStripe(
  sub: Stripe.Subscription,
  existing: SubscriptionRowState | null,
  now: Date = new Date(),
): Record<string, unknown> {
  const item = sub.items?.data?.[0];
  const ids = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: idOf(sub.customer),
    stripePriceId: item?.price?.id ?? null,
    updatedAt: now,
  };
  const status = sub.status;
  if (status === "canceled" || status === "incomplete_expired") {
    return {
      ...ids,
      ...FREE_TIER_SUBSCRIPTION_FIELDS,
      cancelAtPeriodEnd: false,
      canceledAt: date(sub.canceled_at) ?? date(sub.ended_at) ?? now,
      pastDueSince: null,
    };
  }
  const tier =
    tierFromPrice(item?.price) ??
    (isTimewrenPaidTier(sub.metadata?.planTier) ? sub.metadata.planTier : null);
  if (status === "incomplete" || !tier) return ids;

  // Sæder = det betalte antal (højst tierens loft). Under planens minimum
  // gives kun det betalte. Stripe styrer det fakturerede antal.
  const seats = paidSeats(tier, item?.quantity ?? 1);
  const mapped =
    status === "active"
      ? "active"
      : status === "trialing"
        ? "trialing"
        : "past_due"; // past_due, unpaid, paused
  return {
    ...ids,
    status: mapped,
    planTier: tier,
    billingCycle: "monthly",
    seatCount: seats,
    maxSeats: isPerSeatTier(tier) ? seats : maxSeatsForTier(tier),
    isTrial: mapped === "trialing",
    trialEndsAt: date(sub.trial_end) ?? existing?.trialEndsAt ?? now,
    currentPeriodStart: date(item?.current_period_start),
    currentPeriodEnd: date(item?.current_period_end),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    canceledAt: date(sub.canceled_at),
    pastDueSince:
      mapped === "past_due"
        ? existing?.status === "past_due" && existing.pastDueSince
          ? existing.pastDueSince
          : now
        : null,
  };
}

/** Brand og ejer fra metadata på et Stripe-objekt. */
export interface TimewrenMetadata {
  brand: string | null;
  organizationId: string | null;
  userId: string | null;
}

export function readMetadata(
  md: Stripe.Metadata | null | undefined,
): TimewrenMetadata {
  return {
    brand: md?.brand ?? null,
    organizationId: md?.organizationId ?? null,
    userId: md?.userId ?? null,
  };
}

/** Metadata for abonnementet bag en faktura (nyt og gammelt API-format). */
export function invoiceSubscriptionRef(invoice: Stripe.Invoice): {
  subscriptionId: string | null;
  metadata: Stripe.Metadata | null;
} {
  const details = invoice.parent?.subscription_details;
  const legacy = invoice as unknown as {
    subscription?: string | { id: string } | null;
    subscription_details?: { metadata?: Stripe.Metadata | null } | null;
  };
  return {
    subscriptionId: idOf(details?.subscription) ?? idOf(legacy.subscription),
    metadata:
      details?.metadata ?? legacy.subscription_details?.metadata ?? null,
  };
}

/**
 * Brand-metadata på et event, eller null hvis eventet ikke bærer et brand
 * (fx desktop-licensens checkout, som behandles som før).
 */
export function eventBrand(event: Stripe.Event): string | null {
  const obj = event.data.object as { object?: string };
  switch (obj.object) {
    case "checkout.session":
    case "subscription":
      return (
        (obj as { metadata?: Stripe.Metadata | null }).metadata?.brand ?? null
      );
    case "invoice":
      return (
        invoiceSubscriptionRef(obj as Stripe.Invoice).metadata?.brand ?? null
      );
    default:
      return null;
  }
}

/** Beløb i EUR til mails ("€11.00"); Stripe giver cent. */
export function formatEur(cents: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
