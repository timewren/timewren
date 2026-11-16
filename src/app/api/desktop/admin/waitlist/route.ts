import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { desktopWaitlist, users } from "@/lib/db/schema";

/**
 * Verify the request is from an admin user.
 */
async function verifyAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, role: true },
  });

  if (user?.role !== "admin") return null;
  return user;
}

/**
 * GET /api/desktop/admin/waitlist
 *
 * List the desktop waitlist.
 * Auth: admin role required.
 * Query: ?format=json|csv
 *
 * If format=csv, returns a downloadable CSV file.
 */
export async function GET(request: Request) {
  try {
    const admin = await verifyAdmin(request);
    if (!admin) {
      return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";

    const entries = await db
      .select()
      .from(desktopWaitlist)
      .orderBy(desc(desktopWaitlist.createdAt));

    if (format === "csv") {
      const header = "email,tilmeldt";
      const rows = entries.map(
        (e) => `${e.email},${e.createdAt.toISOString().split("T")[0]}`,
      );
      const csv = [header, ...rows].join("\n");

      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="desktop-waitlist-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      total: entries.length,
      entries,
    });
  } catch (error) {
    console.error("[Desktop Admin Waitlist] GET error:", error);
    return NextResponse.json({ error: "Hentning fejlede" }, { status: 500 });
  }
}
