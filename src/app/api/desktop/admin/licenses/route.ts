import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { desktopDevices, desktopLicenses, users } from "@/lib/db/schema";
import { generateLicenseKey } from "@/lib/desktop-auth";

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

const createLicenseSchema = z.object({
  tier: z.enum(["lifetime", "solo", "team"]),
  email: z.string().email().optional(),
  maxDevices: z.number().min(1).max(100).optional(),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/desktop/admin/licenses
 *
 * Create a new desktop license.
 * Auth: admin role required.
 */
export async function POST(request: Request) {
  try {
    const admin = await verifyAdmin(request);
    if (!admin) {
      return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
    }

    const body = await request.json();
    const input = createLicenseSchema.parse(body);

    const licenseKey = generateLicenseKey();
    let userId: string | null = null;

    if (input.email) {
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase().trim()),
        columns: { id: true },
      });
      userId = user?.id ?? null;
    }

    const defaultDevices =
      input.tier === "team" ? 10 : input.tier === "solo" ? 2 : 3;

    const [license] = await db
      .insert(desktopLicenses)
      .values({
        licenseKey,
        tier: input.tier,
        userId,
        maxDevices: input.maxDevices ?? defaultDevices,
        note: input.note ?? null,
        isActive: true,
        expiresAt: null,
      })
      .returning();

    return NextResponse.json({
      licenseKey: license.licenseKey,
      tier: license.tier,
      createdAt: license.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Ugyldige data", details: error.issues },
        { status: 400 },
      );
    }
    console.error("[Desktop Admin Licenses] POST error:", error);
    return NextResponse.json({ error: "Oprettelse fejlede" }, { status: 500 });
  }
}

/**
 * GET /api/desktop/admin/licenses
 *
 * List all desktop licenses.
 * Auth: admin role required.
 * Query: ?tier=lifetime&status=active&search=email
 */
export async function GET(request: Request) {
  try {
    const admin = await verifyAdmin(request);
    if (!admin) {
      return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
    }

    const url = new URL(request.url);
    const tier = url.searchParams.get("tier");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");

    const conditions = [];

    if (tier && ["lifetime", "solo", "team"].includes(tier)) {
      conditions.push(eq(desktopLicenses.tier, tier));
    }

    if (status === "active") {
      conditions.push(eq(desktopLicenses.isActive, true));
    } else if (status === "inactive") {
      conditions.push(eq(desktopLicenses.isActive, false));
    }

    if (search) {
      conditions.push(
        or(
          ilike(desktopLicenses.licenseKey, `%${search}%`),
          ilike(users.email, `%${search}%`),
        ),
      );
    }

    const licenses = await db
      .select({
        id: desktopLicenses.id,
        licenseKey: desktopLicenses.licenseKey,
        tier: desktopLicenses.tier,
        maxDevices: desktopLicenses.maxDevices,
        isActive: desktopLicenses.isActive,
        note: desktopLicenses.note,
        createdAt: desktopLicenses.createdAt,
        expiresAt: desktopLicenses.expiresAt,
        userId: desktopLicenses.userId,
        userEmail: users.email,
        userName: users.name,
      })
      .from(desktopLicenses)
      .leftJoin(users, eq(desktopLicenses.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(desktopLicenses.createdAt));

    // Device counts per user
    const deviceCounts = await db
      .select({
        userId: desktopDevices.userId,
        count: count(),
      })
      .from(desktopDevices)
      .groupBy(desktopDevices.userId);

    const deviceMap = new Map(deviceCounts.map((d) => [d.userId, d.count]));

    return NextResponse.json(
      licenses.map((l) => ({
        ...l,
        devicesUsed: l.userId ? (deviceMap.get(l.userId) ?? 0) : 0,
      })),
    );
  } catch (error) {
    console.error("[Desktop Admin Licenses] GET error:", error);
    return NextResponse.json({ error: "Hentning fejlede" }, { status: 500 });
  }
}
