import { and, eq, gte } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { db } from "@/lib/db";
import {
  clients,
  desktopDevices,
  invoiceLines,
  invoices,
  prepaidPackages,
  projects,
  timeEntries,
} from "@/lib/db/schema";
import {
  authenticateDevice,
  deviceAuthErrorResponse,
} from "@/lib/desktop-auth";
import { resolveDesktopOrgId } from "@/lib/desktop-org";
import { readSyncTombstones } from "@/lib/desktop-sync-tombstones";

interface SyncEntity {
  type: string;
  action: "create" | "update" | "delete";
  data: Record<string, unknown>;
}

/**
 * GET /api/desktop/sync/pull?since=2026-05-23T12:00:00Z
 *
 * Pull changes from the server since the given timestamp.
 *
 * Header: Authorization: Bearer <device-token>
 * Query: since - ISO timestamp of last sync
 *
 * Returns: {
 *   entities: [{ type, action, data }],
 *   serverTime: "..."
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateDevice(request);
    const { userId, deviceId } = auth;

    const since = request.nextUrl.searchParams.get("since");
    if (!since) {
      return NextResponse.json(
        { error: "since parameter is required (ISO timestamp)" },
        { status: 400 },
      );
    }

    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid since timestamp" },
        { status: 400 },
      );
    }

    // Update device last sync time
    await db
      .update(desktopDevices)
      .set({ lastSyncAt: new Date() })
      .where(eq(desktopDevices.id, deviceId));

    // Org-shared entities (clients/projects/prepaid/invoices) sync the whole
    // team's data; time entries stay per-user (visibility model). Org'en
    // opløses deterministisk (samme regel som tRPC) — se resolveDesktopOrgId.
    const orgId = await resolveDesktopOrgId(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: orglessForbiddenMessage() },
        { status: 403 },
      );
    }
    const entities = await fetchChangedEntities(userId, sinceDate, orgId);

    return NextResponse.json({
      entities,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const authResponse = deviceAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[Desktop Sync Pull] Error:", error);
    return NextResponse.json({ error: "Sync pull failed" }, { status: 500 });
  }
}

/**
 * Fetch all entities that have been updated since the given date for a user.
 * Does NOT include activities (privacy).
 */
async function fetchChangedEntities(
  userId: string,
  sinceDate: Date,
  orgId: string | null = null,
): Promise<SyncEntity[]> {
  const entities: SyncEntity[] = [];

  // 1. Clients updated since (org-shared for teams; own for solo)
  const changedClients = await db
    .select()
    .from(clients)
    .where(
      and(
        orgId ? eq(clients.organizationId, orgId) : eq(clients.userId, userId),
        gte(clients.updatedAt, sinceDate),
      ),
    );

  for (const c of changedClients) {
    entities.push({
      type: "client",
      action: c.createdAt >= sinceDate ? "create" : "update",
      data: c as unknown as Record<string, unknown>,
    });
  }

  // 2. Projects updated since
  const changedProjects = await db
    .select()
    .from(projects)
    .where(
      and(
        orgId
          ? eq(projects.organizationId, orgId)
          : eq(projects.userId, userId),
        gte(projects.updatedAt, sinceDate),
      ),
    );

  for (const p of changedProjects) {
    entities.push({
      type: "project",
      action: p.createdAt >= sinceDate ? "create" : "update",
      data: p as unknown as Record<string, unknown>,
    });
  }

  // 3. Time entries updated since
  const changedTimeEntries = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.updatedAt, sinceDate),
      ),
    );

  for (const t of changedTimeEntries) {
    entities.push({
      type: "time_entry",
      action: t.createdAt >= sinceDate ? "create" : "update",
      data: t as unknown as Record<string, unknown>,
    });
  }

  // 4. Klippekort (prepaid packages) updated since
  const changedKlippekort = await db
    .select()
    .from(prepaidPackages)
    .where(
      and(
        orgId
          ? eq(prepaidPackages.organizationId, orgId)
          : eq(prepaidPackages.userId, userId),
        gte(prepaidPackages.updatedAt, sinceDate),
      ),
    );

  for (const k of changedKlippekort) {
    entities.push({
      type: "klippekort",
      action: k.createdAt >= sinceDate ? "create" : "update",
      data: k as unknown as Record<string, unknown>,
    });
  }

  // 5. Invoices updated since
  const changedInvoices = await db
    .select()
    .from(invoices)
    .where(
      and(
        orgId
          ? eq(invoices.organizationId, orgId)
          : eq(invoices.userId, userId),
        gte(invoices.updatedAt, sinceDate),
      ),
    );

  for (const inv of changedInvoices) {
    entities.push({
      type: "invoice_draft",
      action: inv.createdAt >= sinceDate ? "create" : "update",
      data: inv as unknown as Record<string, unknown>,
    });

    // Also fetch invoice lines for changed invoices
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, inv.id));

    for (const line of lines) {
      entities.push({
        type: "invoice_line",
        action: line.createdAt >= sinceDate ? "create" : "update",
        data: line as unknown as Record<string, unknown>,
      });
    }
  }

  // 6. Sletninger. En slettet række efterlader intet at pulle fra sin egen
  // tabel, så uden tombstones ved skrivebordet aldrig hører, at posten er
  // væk — næste redigering fejler med "Entity not found" for evigt.
  const liveIds = new Set(
    entities
      .filter((entity) => !entity.data.isArchived)
      .map((entity) => `${entity.type}:${entity.data.id}`),
  );
  entities.push(
    ...(
      await readSyncTombstones({
        db,
        userId,
        organizationId: orgId,
        sinceDate,
      })
    ).filter((entity) => !liveIds.has(`${entity.type}:${entity.data.id}`)),
  );

  return entities;
}
