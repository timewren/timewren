/**
 * Forsvar i dybden for multibrand: en session eller API-nøgle gælder kun på
 * kontoens eget brand. Login afvises allerede på det andet brand
 * (session.create.before i src/lib/auth.ts), men tRPC og REST-API'et læser
 * sessioner og nøgler uafhængigt af, hvilket site de blev udstedt på.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { authBrandForHost, isHostAuthEnabled, isWrongBrand } from "./host-auth";

/**
 * Hører kontoen til et andet brand end request-hosten? Uden host-auth-flagene
 * altid false (og intet databaseopslag), så alt er som før.
 */
export async function isUserOnOtherBrand(
  userId: string,
  host: string | null | undefined,
): Promise<boolean> {
  if (!isHostAuthEnabled()) return false;
  const [row] = await db
    .select({ brand: users.brand })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return isWrongBrand(row?.brand, authBrandForHost(host));
}

/**
 * Gælder sessionen ikke på request-hosten? Som isUserOnOtherBrand, men en
 * admin-impersonation (support fra timetrack.dk ind i en TimeWren-konto) er
 * undtaget som ved login (session.create.before i src/lib/auth.ts), når den
 * er udstedt af en admin.
 */
export async function isSessionOnOtherBrand(
  session: { user: { id: string }; session: object },
  host: string | null | undefined,
): Promise<boolean> {
  if (!(await isUserOnOtherBrand(session.user.id, host))) return false;
  const impersonator = (session.session as { impersonatedBy?: string | null })
    .impersonatedBy;
  if (!impersonator) return true;
  const [admin] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, impersonator))
    .limit(1);
  return admin?.role !== "admin";
}
