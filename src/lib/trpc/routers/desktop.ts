import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import { currentBrandId } from "@/i18n/brandize";
import { st, tr } from "@/i18n/server-text";
import { assertCheckoutAvailableForBuyer } from "@/lib/billing/assert-checkout";
import { DESKTOP_BRAND_METADATA_KEY } from "@/lib/billing/timewren-stripe";
import { timewrenDesktopPrice } from "@/lib/billing/timewren-stripe-server";
import { getBrand } from "@/lib/brand";
import { SITE_LOCALES, sitePath } from "@/lib/brands/timewren-site";
import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import {
  DESKTOP_LIFETIME_MAX_DEVICES,
  DESKTOP_REFUND_WINDOW_DAYS,
  getAppUrl,
  STRIPE_DESKTOP_LIFETIME_PRICE_ID,
  STRIPE_TAX_ENABLED,
} from "@/lib/config";
import { db } from "@/lib/db";
import {
  desktopDevices,
  desktopLicenseDevices,
  desktopLicenses,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { desktopBrandForHost } from "@/lib/desktop-license-brand";
import { checkRateLimit } from "@/lib/desktop-rate-limit";
import { sendLicenseKeyEmail } from "@/lib/email/desktop-license";
import { getStripe } from "@/lib/stripe";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { protectedProcedure, publicProcedure, router } from "../trpc";

/**
 * True if the user behind `email` already has an active TimeTrack Cloud
 * subscription — in which case the desktop app is already included and they
 * should not buy a separate lifetime license.
 */
async function emailHasActiveCloud(
  email: string,
  brand: "timetrack" | "timewren",
): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase().trim()),
    columns: { id: true, brand: true },
  });
  // A Cloud account of the other brand does not include this brand's desktop.
  if (!user || user.brand !== brand) return false;

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, user.id),
  });
  if (!sub) return false;

  const now = new Date();
  return (
    sub.status === "active" ||
    sub.status === "past_due" ||
    (sub.status === "trialing" && sub.trialEndsAt > now)
  );
}

/**
 * Byg Stripe checkout-session-parametrene til en Desktop Livstid-licens.
 * Ren funktion (intet Stripe-kald) så price-id'et fra env og CVR/moms-
 * opsætningen er testbare uden en rigtig Stripe-nøgle.
 */
export function buildDesktopCheckoutSessionParams(opts: {
  email: string;
  appUrl: string;
  priceId: string;
  maxDevices: number;
  taxEnabled: boolean;
}): Stripe.Checkout.SessionCreateParams {
  const { email, appUrl, priceId, maxDevices, taxEnabled } = opts;
  return {
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    // Create a customer + a downloadable invoice with the buyer's company
    // details and CVR/VAT — Danish business buyers need this for bookkeeping.
    customer_creation: "always",
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    invoice_creation: {
      enabled: true,
      invoice_data: { metadata: { product: "desktop_lifetime" } },
    },
    allow_promotion_codes: true,
    success_url: `${appUrl}/download/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/download?canceled=1`,
    metadata: {
      tier: "lifetime",
      license_tier: "lifetime",
      max_devices: String(maxDevices),
    },
    // Stripe Tax (auto VAT + EU reverse-charge). Off until configured.
    // customer_update is left out on purpose: Stripe only accepts it together
    // with `customer`, not with customer_email. Tax uses the address from
    // billing_address_collection.
    ...(taxEnabled ? { automatic_tax: { enabled: true } } : {}),
  };
}

/** Throttle offentlige procedurer pr. IP (#1103). */
export async function assertPublicRateLimit(
  headers: Headers | null | undefined,
  type: "desktopCheckout" | "desktopRefund",
) {
  const ip = headers ? getClientIp(headers) : "unknown";
  const limit = await rateLimiter.check(ipRateLimitKey(ip, type), type);
  if (!limit.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: await tr("serverErrors", "desktop.tooManyAttempts"),
    });
  }
}

/**
 * Checkout-parametrene til TimeWren Desktops livstidslicens (EUR). Som
 * TimeTracks, men på TimeWrens host, med Stripe Tax altid til (som Cloud) og
 * Checkout vist som "TimeWren". Metadata bærer `desktop_brand`, aldrig
 * `brand`: et event med metadata.brand ville gå til Cloud-handleren i stedet
 * for at udstede licensen (se DESKTOP_BRAND_METADATA_KEY).
 */
export function buildTimewrenDesktopCheckoutSessionParams(opts: {
  email: string;
  /** https://<TimeWrens primære host>, aldrig timetrack.dk. */
  appUrl: string;
  priceId: string;
  maxDevices: number;
  locale?: string;
}): Stripe.Checkout.SessionCreateParams {
  const locale = SITE_LOCALES.find((l) => l === opts.locale) ?? "en";
  const base = buildDesktopCheckoutSessionParams({
    ...opts,
    taxEnabled: true,
  });
  const site = opts.appUrl.replace(/\/+$/, "");
  const page = `${site}${sitePath("/desktop", locale)}`;
  return {
    ...base,
    // No JS on the marketing site: the page shows the notice with :target.
    success_url: `${page}#bought`,
    cancel_url: `${page}#buy`,
    invoice_creation: {
      enabled: true,
      invoice_data: {
        metadata: {
          product: "desktop_lifetime",
          [DESKTOP_BRAND_METADATA_KEY]: "timewren",
        },
      },
    },
    // The Stripe account is named after TimeTrack; Checkout shows TimeWren.
    branding_settings: { display_name: "TimeWren" },
    locale,
    metadata: {
      ...base.metadata,
      [DESKTOP_BRAND_METADATA_KEY]: "timewren",
      locale,
    },
  };
}

/**
 * Start a Desktop Livstid checkout for the brand the Host header selects:
 * TimeTrack in DKK (STRIPE_DESKTOP_LIFETIME_PRICE_ID) or TimeWren in EUR
 * (Stripe price by lookup key). Shared by the tRPC mutation (timetrack.dk)
 * and the form endpoint on timewren.com (api/desktop/checkout).
 */
export async function startDesktopLifetimeCheckout(opts: {
  email: string;
  host: string | null | undefined;
  locale?: string;
}): Promise<{ url: string }> {
  const timewren = desktopBrandForHost(opts.host) === "timewren";

  const notConfigured = async () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message: await tr("serverErrors", "desktop.purchaseNotConfigured"),
    });

  if (timewren) {
    // TimeWren has its own Stripe setup (lookup keys): no TimeTrack price id.
    if (!process.env.STRIPE_SECRET_KEY?.trim() || isDemoMode()) {
      throw await notConfigured();
    }
  } else {
    // TimeWren accounts pay with Stripe, never in TimeTrack's checkout.
    await assertCheckoutAvailableForBuyer(db, {
      host: opts.host,
      email: opts.email,
    });
    if (!STRIPE_DESKTOP_LIFETIME_PRICE_ID) throw await notConfigured();
  }

  // Cloud-abonnenter har allerede desktop inkluderet — undgå dobbeltkøb.
  if (
    await emailHasActiveCloud(opts.email, timewren ? "timewren" : "timetrack")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      // Kaldets brand: "TimeWren Cloud" på timewren.com.
      message: await tr("serverErrors", "desktop.includedInCloud", {
        brand: getBrand(timewren ? "timewren" : currentBrandId()).name,
      }),
    });
  }

  const stripe = getStripe();
  let params: Stripe.Checkout.SessionCreateParams;
  if (timewren) {
    let price: Stripe.Price;
    try {
      price = await timewrenDesktopPrice(stripe);
    } catch (error) {
      console.error("[Desktop checkout]", (error as Error).message);
      throw await notConfigured();
    }
    params = buildTimewrenDesktopCheckoutSessionParams({
      email: opts.email,
      appUrl: siteBaseUrl(),
      priceId: price.id,
      maxDevices: DESKTOP_LIFETIME_MAX_DEVICES,
      locale: opts.locale,
    });
  } else {
    params = buildDesktopCheckoutSessionParams({
      email: opts.email,
      appUrl: getAppUrl(),
      priceId: STRIPE_DESKTOP_LIFETIME_PRICE_ID,
      maxDevices: DESKTOP_LIFETIME_MAX_DEVICES,
      taxEnabled: STRIPE_TAX_ENABLED,
    });
  }

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: await tr("serverErrors", "desktop.checkoutFailed"),
    });
  }
  return { url: session.url };
}

export const desktopRouter = router({
  /**
   * Opret et Stripe one-time checkout til en Desktop Livstid-licens (se
   * DESKTOP_LIFETIME_PRICE). Kræver ingen konto — kun en email. Webhooken
   * genererer licensnøglen og sender den på email efter betaling. Faktura
   * (m. CVR/moms) udstedes af Stripe.
   */
  createLifetimeCheckout: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPublicRateLimit(ctx.headers, "desktopCheckout");
      return startDesktopLifetimeCheckout({
        email: input.email,
        host: ctx.headers?.get("host"),
      });
    }),

  /**
   * Selv-betjent refundering inden for returretten. Verificerer licensnøgle +
   * email, refunderer betalingen i Stripe og deaktiverer licensen. Webhooken
   * (charge.refunded) frigør derudover devices.
   */
  requestRefund: publicProcedure
    .input(
      z.object({
        licenseKey: z.string().min(1),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPublicRateLimit(ctx.headers, "desktopRefund");
      const license = await ctx.db.query.desktopLicenses.findFirst({
        where: eq(desktopLicenses.licenseKey, input.licenseKey.trim()),
      });

      // Generic error so we don't leak which licenses/emails exist.
      const invalid = () =>
        new TRPCError({
          code: "BAD_REQUEST",
          message: st("desktop.licenseMismatch"),
        });

      if (!license) {
        throw invalid();
      }
      if (
        !license.email ||
        license.email.toLowerCase() !== input.email.toLowerCase().trim()
      ) {
        throw invalid();
      }

      if (!license.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "desktop.licenseAlreadyInactive"),
        });
      }

      if (!license.stripePaymentIntentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "desktop.notAutoRefundable"),
        });
      }

      const ageMs = Date.now() - license.createdAt.getTime();
      const windowMs = DESKTOP_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > windowMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "desktop.refundWindowExpired", {
            days: DESKTOP_REFUND_WINDOW_DAYS,
          }),
        });
      }

      // Refund in Stripe — the charge.refunded webhook also revokes + releases
      // devices, but we deactivate here too for immediate feedback (idempotent).
      const stripe = getStripe();
      await stripe.refunds.create({
        payment_intent: license.stripePaymentIntentId,
      });

      await ctx.db
        .update(desktopLicenses)
        .set({ isActive: false })
        .where(eq(desktopLicenses.id, license.id));

      await ctx.db
        .delete(desktopLicenseDevices)
        .where(eq(desktopLicenseDevices.licenseId, license.id));

      return { success: true };
    }),

  /**
   * Gensend licensnøgle(r) til en købs-email. Svarer altid generisk, så vi
   * ikke afslører hvilke emails der har en licens.
   */
  resendLicenseKey: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase().trim();

      if (!(await checkRateLimit(`resend-key:${email}`, 3, 60_000))) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "desktop.tooManyAttempts"),
        });
      }

      const licenses = await db.query.desktopLicenses.findMany({
        where: and(
          eq(desktopLicenses.email, email),
          eq(desktopLicenses.isActive, true),
        ),
      });

      for (const lic of licenses) {
        await sendLicenseKeyEmail({
          to: email,
          licenseKey: lic.licenseKey,
          tier: lic.tier,
          maxDevices: lic.maxDevices,
        });
      }

      return { success: true };
    }),

  /** Hent brugerens tilsluttede desktop-enheder */
  devices: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.desktopDevices.findMany({
      where: eq(desktopDevices.userId, ctx.session.user.id),
      orderBy: desc(desktopDevices.lastSyncAt),
    });
  }),

  /** Fjern en desktop-enhed (kun egne enheder) */
  removeDevice: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(desktopDevices)
        .where(
          and(
            eq(desktopDevices.id, input.deviceId),
            eq(desktopDevices.userId, ctx.session.user.id),
          ),
        );
    }),

  /**
   * Hent brugerens desktop-licens. Hvis brugeren købte uden konto og nu er
   * logget ind med samme email, kobles den konto-løse licens automatisk.
   */
  license: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const linked = await ctx.db.query.desktopLicenses.findFirst({
      where: eq(desktopLicenses.userId, userId),
    });
    if (linked) return linked;

    const email = ctx.session.user.email?.toLowerCase();
    if (!email) return null;

    const unlinked = await ctx.db.query.desktopLicenses.findFirst({
      where: and(
        eq(desktopLicenses.email, email),
        isNull(desktopLicenses.userId),
      ),
    });
    if (!unlinked) return null;

    await ctx.db
      .update(desktopLicenses)
      .set({ userId })
      .where(eq(desktopLicenses.id, unlinked.id));

    return { ...unlinked, userId };
  }),

  /**
   * Faktura-link (Stripe hosted invoice) + refund-egnethed for brugerens egen
   * købte licens. Bruges i dashboard-licensstyringen.
   */
  myLicenseBilling: protectedProcedure.query(async ({ ctx }) => {
    const license = await ctx.db.query.desktopLicenses.findFirst({
      where: eq(desktopLicenses.userId, ctx.session.user.id),
    });
    if (!license?.stripePaymentIntentId) {
      return { invoiceUrl: null, refundable: false };
    }

    const ageMs = Date.now() - license.createdAt.getTime();
    const refundable =
      license.isActive &&
      ageMs <= DESKTOP_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    let invoiceUrl: string | null = null;
    try {
      const stripe = getStripe();
      // Prefer the hosted invoice (has the buyer's CVR/VAT) via the customer.
      if (license.stripeCustomerId) {
        const invoices = await stripe.invoices.list({
          customer: license.stripeCustomerId,
          limit: 1,
        });
        const inv = invoices.data[0];
        invoiceUrl = inv?.hosted_invoice_url ?? inv?.invoice_pdf ?? null;
      }
      // Fall back to the charge receipt.
      if (!invoiceUrl) {
        const pi = await stripe.paymentIntents.retrieve(
          license.stripePaymentIntentId,
          { expand: ["latest_charge"] },
        );
        const charge = pi.latest_charge;
        if (charge && typeof charge !== "string") {
          invoiceUrl = charge.receipt_url ?? null;
        }
      }
    } catch (err) {
      console.error("[desktop.myLicenseBilling] Stripe lookup failed:", err);
    }

    return { invoiceUrl, refundable };
  }),

  /** Selv-betjent refundering for den indloggede brugers egen licens. */
  refundOwnLicense: protectedProcedure.mutation(async ({ ctx }) => {
    const license = await ctx.db.query.desktopLicenses.findFirst({
      where: eq(desktopLicenses.userId, ctx.session.user.id),
    });

    if (!license) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "desktop.noLicenseFound"),
      });
    }
    if (!license.isActive) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "desktop.noActiveLicenseToRefund"),
      });
    }
    if (!license.stripePaymentIntentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "desktop.licenseNotAutoRefundable"),
      });
    }

    const ageMs = Date.now() - license.createdAt.getTime();
    if (ageMs > DESKTOP_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "desktop.refundWindowExpiredShort", {
          days: DESKTOP_REFUND_WINDOW_DAYS,
        }),
      });
    }

    const stripe = getStripe();
    await stripe.refunds.create({
      payment_intent: license.stripePaymentIntentId,
    });

    await ctx.db
      .update(desktopLicenses)
      .set({ isActive: false })
      .where(eq(desktopLicenses.id, license.id));
    await ctx.db
      .delete(desktopLicenseDevices)
      .where(eq(desktopLicenseDevices.licenseId, license.id));

    return { success: true };
  }),
});
