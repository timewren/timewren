import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { db } from "@/lib/db";
import {
  clients,
  desktopDevices,
  invoiceLines,
  invoices,
  organizations,
  prepaidPackages,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import {
  authenticateDevice,
  deviceAuthErrorResponse,
} from "@/lib/desktop-auth";
import { resolveDesktopOrgId } from "@/lib/desktop-org";

interface SyncEntity {
  type: string;
  action: "create";
  data: Record<string, unknown>;
}

/**
 * GET /api/desktop/sync/full
 *
 * Full sync: returns ALL data for the user (first-time sync).
 * Same format as pull but includes everything.
 *
 * Header: Authorization: Bearer <device-token>
 *
 * Returns: {
 *   entities: [{ type, action: "create", data }],
 *   serverTime: "..."
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDevice(request);
    const { userId, deviceId } = auth;

    // Update device last sync time
    await db
      .update(desktopDevices)
      .set({ lastSyncAt: new Date() })
      .where(eq(desktopDevices.id, deviceId));

    const entities: SyncEntity[] = [];

    // 0. User profile data (name, email, hourly rate, org info)
    const [userRow] = await db
      .select({
        name: users.name,
        email: users.email,
        defaultHourlyRate: users.defaultHourlyRate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Look up the user's primary organization — deterministisk, samme regel
    // som tRPC og de øvrige sync-ruter (se resolveDesktopOrgId).
    const orgId = await resolveDesktopOrgId(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: orglessForbiddenMessage() },
        { status: 403 },
      );
    }
    const [org] = orgId
      ? await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1)
      : [];

    const userProfile: Record<string, unknown> = {};
    if (userRow) {
      userProfile.name = userRow.name;
      userProfile.email = userRow.email;
      userProfile.defaultHourlyRate = userRow.defaultHourlyRate;
    }
    if (org) {
      userProfile.organizationName = org.name;
    }

    // 1. All clients — org-shared (whole team's clients) so a member can track
    //    time against them; own data for solo.
    const allClients = await db
      .select()
      .from(clients)
      .where(
        orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
      );

    for (const c of allClients) {
      entities.push({
        type: "client",
        action: "create",
        data: c as unknown as Record<string, unknown>,
      });
    }

    // 2. All projects
    const allProjects = await db
      .select()
      .from(projects)
      .where(
        orgId
          ? eq(projects.organizationId, orgId)
          : eq(projects.userId, userId),
      );

    for (const p of allProjects) {
      entities.push({
        type: "project",
        action: "create",
        data: p as unknown as Record<string, unknown>,
      });
    }

    // 3. All time entries
    const allTimeEntries = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.userId, userId));

    for (const t of allTimeEntries) {
      entities.push({
        type: "time_entry",
        action: "create",
        data: t as unknown as Record<string, unknown>,
      });
    }

    // 4. All klippekort (prepaid packages)
    const allKlippekort = await db
      .select()
      .from(prepaidPackages)
      .where(
        orgId
          ? eq(prepaidPackages.organizationId, orgId)
          : eq(prepaidPackages.userId, userId),
      );

    for (const k of allKlippekort) {
      entities.push({
        type: "klippekort",
        action: "create",
        data: k as unknown as Record<string, unknown>,
      });
    }

    // 5. All invoices + their lines
    const allInvoices = await db
      .select()
      .from(invoices)
      .where(
        orgId
          ? eq(invoices.organizationId, orgId)
          : eq(invoices.userId, userId),
      );

    for (const inv of allInvoices) {
      entities.push({
        type: "invoice_draft",
        action: "create",
        data: inv as unknown as Record<string, unknown>,
      });

      const lines = await db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, inv.id));

      for (const line of lines) {
        entities.push({
          type: "invoice_line",
          action: "create",
          data: line as unknown as Record<string, unknown>,
        });
      }
    }

    return NextResponse.json({
      entities,
      serverTime: new Date().toISOString(),
      userProfile,
    });
  } catch (error) {
    const authResponse = deviceAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[Desktop Sync Full] Error:", error);
    return NextResponse.json({ error: "Full sync failed" }, { status: 500 });
  }
}
