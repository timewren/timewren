import { eq } from "drizzle-orm";
import { DEFAULT_LOCALE, isAvailableLocale, type Locale } from "@/i18n/config";
import { users } from "@/lib/db/schema";

/**
 * Modtagerens sprog (`users.locale`).
 *
 * 1. `email`: selve modtageren, hvis vedkommende har en profil.
 * 2. `userId`: ellers afsenderen/kontoen mailen sendes på vegne af
 *    (kundeportal-modtagere og andre eksterne uden profil).
 * 3. `fallback`, ellers dansk.
 *
 * Et mislykket opslag må aldrig stoppe en mail.
 */
export async function getRecipientLocale(opts: {
  userId?: string | null;
  email?: string | null;
  fallback?: string | null;
}): Promise<Locale> {
  try {
    // Lazy: mail-skabeloner og tests uden DATABASE_URL må ikke dø af importen.
    const { db } = await import("@/lib/db");
    if (opts.email) {
      const row = await db.query.users.findFirst({
        where: eq(users.email, opts.email.toLowerCase()),
        columns: { locale: true },
      });
      if (isAvailableLocale(row?.locale)) return row.locale;
    }
    if (opts.userId) {
      const row = await db.query.users.findFirst({
        where: eq(users.id, opts.userId),
        columns: { locale: true },
      });
      if (isAvailableLocale(row?.locale)) return row.locale;
    }
  } catch (error) {
    if (process.env.DATABASE_URL) {
      console.error("Recipient locale lookup failed:", error);
    }
  }
  return isAvailableLocale(opts.fallback) ? opts.fallback : DEFAULT_LOCALE;
}
