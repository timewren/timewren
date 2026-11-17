import { eq, sql } from "drizzle-orm";
import type { db as Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isDemoEmail, isDemoMode } from "@/lib/demo/demo-mode";
import { isEmailVerificationRequired } from "./email-verification";

type Database = typeof Db;

/** Adresser fra ADMIN_EMAIL (kommasepareret), små bogstaver. */
export function adminEmailsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return (env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Admin-bootstrap til selvhostede instanser. Kaldes ved signup og login.
 *
 * - `ADMIN_EMAIL` sat: brugeren med den adresse bliver instans-admin.
 * - Ellers: den ældste bruger bliver admin, men kun mens instansen ikke har
 *   nogen admin. En kørende instans med en admin (produktion) berøres aldrig.
 *
 * Kun en bekræftet adresse promoveres (eller en hvor verifikation er slået
 * fra), så ingen kan kapre admin ved at registrere ADMIN_EMAIL først (medmindre verifikation er slået fra, jf. advarslen).
 * Returnerer true, hvis brugeren blev gjort til admin nu.
 */
export async function bootstrapAdmin(
  database: Database,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const user = await database.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, emailVerified: true, role: true },
  });
  if (!user || user.role === "admin") return false;
  // Offentlig demo: en besøgende må aldrig blive instans-admin.
  if (isDemoMode(env) && isDemoEmail(user.email)) return false;
  if (user.emailVerified !== true && isEmailVerificationRequired(env)) {
    return false;
  }

  const adminEmails = adminEmailsFromEnv(env);
  if (adminEmails.length > 0) {
    if (!adminEmails.includes(user.email.toLowerCase())) return false;
    await database
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, user.id));
    console.info("[Auth] ADMIN_EMAIL: bruger gjort til instans-admin.");
    return true;
  }

  // Ét atomisk UPDATE: ingen admin findes endnu, og brugeren er den ældste.
  const promoted = await database
    .update(users)
    .set({ role: "admin" })
    .where(
      sql`${users.id} = ${user.id}
        AND NOT EXISTS (SELECT 1 FROM ${users} u WHERE u.role = 'admin')
        AND ${users.id} = (
          SELECT u.id FROM ${users} u ORDER BY u."createdAt" ASC, u.id ASC LIMIT 1
        )`,
    )
    .returning({ id: users.id });
  if (promoted.length > 0) {
    console.info("[Auth] Første bruger på tom instans er gjort til admin.");
    return true;
  }
  return false;
}
