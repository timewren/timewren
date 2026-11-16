import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { requestAppUrl } from "@/lib/brands/app-url";
import { db } from "@/lib/db";
import { resolveStartPage } from "@/lib/start-page.server";

/**
 * Login-landingsside (#startside): slår brugerens valgte startside op og
 * redirecter dertil. Brugt som callbackURL/redirect-mål efter login i stedet
 * for et hardkodet /dashboard, så valget i Indstillinger rent faktisk virker.
 * Falder tilbage til /dashboard uden session, ukendt værdi eller hvis siden
 * ikke længere er tilgængelig (modul slået fra / rolle uden adgang).
 */
export async function GET(_request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  // TimeWren-hosts redirecter til deres egen host, aldrig til TimeTracks app-URL.
  const appUrl = await requestAppUrl();
  if (!userId) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
    columns: { startPage: true },
  });

  const orgId = await resolveActiveOrgId({
    db,
    userId,
    session: session as unknown as Record<string, unknown>,
  });
  const target = await resolveStartPage(db, userId, orgId, user?.startPage);

  // request.url er containerens interne adresse (0.0.0.0:3000) bag proxyen.
  return NextResponse.redirect(new URL(target, appUrl));
}
