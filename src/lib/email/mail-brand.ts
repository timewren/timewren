import { type Brand, getBrand } from "@/lib/brand";
import {
  type BrandKey,
  getBrandConfigs,
  isMultibrandEnabled,
} from "@/lib/brands/registry";
import { appUrlEnv } from "@/lib/runtime-env";

/**
 * Brandet i en mail. Sendes som prop til skabelonerne (ikke via React context,
 * som ikke findes i server-laget). Udeladt prop = build-brandet, som hidtil.
 * Se docs/specs/timewren-cloud.md → Mails.
 */
export interface MailBrand {
  key: BrandKey;
  brand: Brand;
  from: string;
  logoUrl: string;
  appUrl: string;
  siteUrl: string;
  dashboardUrl: string;
  loginUrl: string;
  locale: string;
}

/** Mailidentitet for en kontos brand (users.brand / organizations.brand). */
export function mailBrandFor(key: string | null | undefined): MailBrand {
  const k: BrandKey = key === "timewren" ? "timewren" : "timetrack";
  const cfg = getBrandConfigs()[k];
  const site = `https://${cfg.hosts[0]}`;
  // TimeWrens app kører på den primære host sammen med marketing (ingen
  // app.-host); TimeTrack beholder sin app.-host.
  const app =
    k === "timewren" ? site : `https://${cfg.hosts[cfg.hosts.length - 1]}`;
  const b = getBrand(k);
  return {
    key: k,
    brand: {
      ...b,
      supportEmail: cfg.supportEmail,
      contactEmail: k === "timewren" ? cfg.supportEmail : b.contactEmail,
    },
    from: cfg.mailFrom,
    logoUrl:
      k === "timewren" ? `${site}/brand/timewren/mark-64.png` : b.logo.mailIcon,
    appUrl: app,
    siteUrl: site,
    dashboardUrl: `${app}/dashboard`,
    loginUrl: `${app}/login`,
    locale: cfg.defaultLocale,
  };
}

/**
 * MailBrand for en kontos brand, men kun for ikke-standardbrands. undefined =
 * skabelonernes build-brand, præcis som før multibrand (TimeTrack-mails er
 * uændrede).
 */
export function recipientMailBrand(
  key: string | null | undefined,
): MailBrand | undefined {
  return key === "timewren" ? mailBrandFor(key) : undefined;
}

/**
 * Mailbrandet for modtageren. `brand` (users.brand / organizations.brand)
 * bruges, hvis kalderen kender det (også null = "ingen"); ellers slås kontoen
 * op på e-mail og derefter userId (som getRecipientLocale). Uden
 * MULTIBRAND_ENABLED=1 slås intet op. Et mislykket opslag stopper aldrig en
 * mail; så bruges build-brandet.
 */
export async function resolveMailBrand(opts: {
  brand?: string | null;
  userId?: string | null;
  email?: string | null;
}): Promise<MailBrand | undefined> {
  if (opts.brand !== undefined) return recipientMailBrand(opts.brand);
  if (!isMultibrandEnabled()) return undefined;
  try {
    // Lazy: skabeloner og tests uden DATABASE_URL må ikke dø af importen.
    const [{ db }, { users }, { eq }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/db/schema"),
      import("drizzle-orm"),
    ]);
    if (opts.email) {
      const row = await db.query.users.findFirst({
        where: eq(users.email, opts.email.toLowerCase()),
        columns: { brand: true },
      });
      if (row) return recipientMailBrand(row.brand);
    }
    if (opts.userId) {
      const row = await db.query.users.findFirst({
        where: eq(users.id, opts.userId),
        columns: { brand: true },
      });
      if (row) return recipientMailBrand(row.brand);
    }
  } catch (error) {
    if (process.env.DATABASE_URL) {
      console.error("Recipient brand lookup failed:", error);
    }
  }
  return undefined;
}

/**
 * Flytter et link på appens egen URL (NEXT_PUBLIC_APP_URL) til kontoens
 * brand-host, så kaldere, der selv har bygget linket, ikke sender en
 * TimeWren-konto til timetrack.dk. Andre links (fx Stripe, kundeportal på
 * eget domæne) og mails uden mailBrand er uændrede.
 */
export function brandUrl<T extends string | null | undefined>(
  url: T,
  mb: MailBrand | undefined,
): T {
  if (!mb || !url) return url;
  const app = appUrlEnv();
  if (!app) return url;
  try {
    const from = new URL(app).origin;
    const target = new URL(url);
    if (target.origin !== from) return url;
    return `${mb.appUrl}${target.pathname}${target.search}${target.hash}` as T;
  } catch {
    return url;
  }
}
