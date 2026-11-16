import { and, eq, gte, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  clients,
  imports,
  projects,
  tags,
  timeEntries,
  timeEntryTags,
  users,
} from "@/lib/db/schema";
import { failStaleProcessingImports } from "@/lib/imports/status";
import {
  createTimeOpsClient,
  type TimeOpsRegistration,
} from "@/lib/integrations/timeops";
import { entryDateFromStr, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import type {
  PreviewClient,
  PreviewData,
  PreviewProject,
  PreviewTag,
} from "@/lib/trpc/routers/imports";
import { getRateForTimeEntry } from "@/lib/trpc/routers/time";
import { decrypt } from "@/lib/utils/encryption";
import { captureRouteError } from "@/lib/utils/sentry";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface ConflictResolutions {
  clients: Record<string, "skip" | "create_new" | "merge">;
  projects: Record<string, "skip" | "create_new" | "merge">;
}

interface IdMapping {
  clients: Record<string, string>;
  projects: Record<string, string>;
  tags: Record<string, string>;
}

interface ImportError {
  resource: "client" | "project" | "tag" | "entry";
  sourceId?: string;
  message: string;
  timestamp: string;
}

interface ImportResults {
  clients: { imported: number; skipped: number; merged: number };
  projects: { imported: number; skipped: number; merged: number };
  tags: { imported: number; skipped: number };
  entries: { imported: number; skipped: number; failed: number };
}

export const GET = withCronLogging("import", async (_request) => {
  // Imports der er forladt i "processing" (fx ved et deploy midt i
  // kørslen), markeres som failed, så brugeren kan starte en ny.
  const staleFailed = await failStaleProcessingImports(db);
  if (staleFailed > 0) {
    console.warn(
      `[Cron][import] Marked ${staleFailed} stale import(s) as failed`,
    );
  }

  // Pick up ONE running import at a time. The transaction:
  // 1. SELECT … FOR UPDATE SKIP LOCKED — lock the row so concurrent
  //    cron workers skip it.
  // 2. UPDATE status → 'processing' — so after the transaction commits
  //    and the row-level lock is released, other workers won't pick it
  //    up either (they filter WHERE status = 'running').
  const importRow = await db.transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      SELECT id FROM imports
      WHERE status = 'running'
      ORDER BY updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    // Handle both Postgres.js and node-postgres result shapes
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle result types vary
    const rows = (result as any).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;

    // Mark as 'processing' while lock is held so no other worker can
    // grab this import after the transaction commits.
    await tx
      .update(imports)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(imports.id, row.id));

    const fullRow = await tx.query.imports.findFirst({
      where: eq(imports.id, row.id),
    });
    return fullRow ?? null;
  });

  if (!importRow) {
    return {
      itemsProcessed: staleFailed,
      itemsSucceeded: 0,
      itemsFailed: staleFailed,
    };
  }

  console.warn(
    `[Cron][import] Processing import ${importRow.id} for user ${importRow.userId}`,
  );

  try {
    await processImport(importRow);
    return {
      itemsProcessed: 1,
      itemsSucceeded: 1,
      metadata: { importId: importRow.id },
    };
  } catch (err) {
    console.error(`[Cron][import] Import ${importRow.id} failed:`, err);
    const existingErrors = (importRow.errors as ImportError[]) ?? [];
    await db
      .update(imports)
      .set({
        status: "failed",
        errors: [
          ...existingErrors,
          {
            resource: "entry",
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          },
        ],
        completedAt: new Date(),
        credentials: null,
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importRow.id));

    // Send failure email notification
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, importRow.userId),
        columns: { email: true, name: true },
      });
      if (user?.email) {
        const { sendImportCompleteEmail } = await import(
          "@/lib/email/import-notification"
        );
        await sendImportCompleteEmail({
          to: user.email,
          userName: user.name ?? "bruger",
          userId: importRow.userId,
          status: "failed",
          importedEntries: 0,
          skippedEntries: 0,
          failedEntries: 0,
          totalEntries: importRow.totalEntries,
          source: importRow.source === "timeops" ? "TimeOps" : importRow.source,
        });
      }
    } catch (emailErr) {
      console.error("[Cron][import] Failed to send failure email:", emailErr);
    }

    // Return a Response directly so the helper logs it as success=true
    // (the business failure is already persisted in the imports table).
    // We return itemsFailed=1 so the cron log shows the partial failure.
    captureRouteError(err, { route: "/api/cron/import", type: "cron" });
    return NextResponse.json(
      {
        success: false,
        jobName: "import",
        itemsProcessed: 1,
        itemsSucceeded: 0,
        itemsFailed: 1,
        error: String(err),
      },
      { status: 500 },
    );
  }
});

async function processImport(
  importRow: typeof imports.$inferSelect,
): Promise<void> {
  await runPhases(importRow);
}

async function runPhases(
  importRow: typeof imports.$inferSelect,
): Promise<void> {
  if (!importRow.credentials) {
    throw new Error("Import row missing credentials");
  }
  const decrypted = JSON.parse(decrypt(importRow.credentials)) as {
    apiKey: string;
  };
  const client = createTimeOpsClient(decrypted.apiKey);

  const orgId = await getUserOrgId(importRow.userId);

  const previewData = importRow.previewData as PreviewData;
  const resolutions =
    (importRow.conflictResolutions as ConflictResolutions) ?? {
      clients: {},
      projects: {},
    };

  const idMapping: IdMapping = (importRow.idMapping as IdMapping) ?? {
    clients: {},
    projects: {},
    tags: {},
  };
  const errors: ImportError[] = (importRow.errors as ImportError[]) ?? [];
  const results: ImportResults = (importRow.results as ImportResults) ?? {
    clients: { imported: 0, skipped: 0, merged: 0 },
    projects: { imported: 0, skipped: 0, merged: 0 },
    tags: { imported: 0, skipped: 0 },
    entries: { imported: 0, skipped: 0, failed: 0 },
  };

  // Helper to bail out early if the user cancelled mid-import.
  const isCancelled = async () => {
    const row = await db.query.imports.findFirst({
      where: eq(imports.id, importRow.id),
      columns: { status: true },
    });
    return row?.status === "cancelled";
  };

  // Phase 1: Tags
  await runTagsPhase(
    importRow.userId,
    orgId,
    previewData.tags,
    idMapping,
    results,
    errors,
  );
  await persistProgress(importRow.id, { idMapping, results, errors });
  if (await isCancelled()) return;

  // Phase 2: Clients
  await runClientsPhase(
    importRow.userId,
    orgId,
    previewData.clients,
    resolutions.clients,
    idMapping,
    results,
    errors,
  );
  await persistProgress(importRow.id, { idMapping, results, errors });
  if (await isCancelled()) return;

  // Phase 3: Projects
  await runProjectsPhase(
    importRow.userId,
    orgId,
    previewData.projects,
    resolutions.projects,
    idMapping,
    results,
    errors,
  );
  await persistProgress(importRow.id, { idMapping, results, errors });
  if (await isCancelled()) return;

  // Phase 4: Entries (per-page cancel check is inside runEntriesPhase)
  await runEntriesPhase(importRow, orgId, client, idMapping, results, errors);

  // Re-check status before overwriting — if the user cancelled during
  // entry processing, runEntriesPhase returned early but we must NOT
  // overwrite the 'cancelled' status with 'completed'.
  if (await isCancelled()) return;

  // Phase 5: Finalize
  const finalStatus =
    errors.length === 0 ? "completed" : "completed_with_errors";
  await db
    .update(imports)
    .set({
      status: finalStatus,
      results,
      errors,
      idMapping,
      completedAt: new Date(),
      credentials: null,
      updatedAt: new Date(),
    })
    .where(eq(imports.id, importRow.id));

  // Send email notification on completion
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, importRow.userId),
      columns: { email: true, name: true },
    });
    if (user?.email) {
      const { sendImportCompleteEmail } = await import(
        "@/lib/email/import-notification"
      );
      await sendImportCompleteEmail({
        to: user.email,
        userName: user.name ?? "bruger",
        userId: importRow.userId,
        status: finalStatus,
        importedEntries: results.entries.imported,
        skippedEntries: results.entries.skipped,
        failedEntries: results.entries.failed,
        totalEntries: importRow.totalEntries,
        source: importRow.source === "timeops" ? "TimeOps" : importRow.source,
      });
    }
  } catch (emailErr) {
    console.error("[Cron][import] Failed to send completion email:", emailErr);
    // Don't fail the import over email
  }

  // Clear stored API key from user profile — the one-time import is
  // done, no reason to keep credentials around.
  await db
    .update(users)
    .set({ timeopsApiKey: null })
    .where(eq(users.id, importRow.userId));
}

async function persistProgress(
  importId: string,
  data: {
    idMapping: IdMapping;
    results: ImportResults;
    errors: ImportError[];
  },
): Promise<void> {
  await db
    .update(imports)
    .set({
      idMapping: data.idMapping,
      results: data.results,
      errors: data.errors,
      updatedAt: new Date(),
    })
    .where(eq(imports.id, importId));
}

async function runTagsPhase(
  userId: string,
  orgId: string | null,
  previewTags: PreviewTag[],
  idMapping: IdMapping,
  results: ImportResults,
  errors: ImportError[],
): Promise<void> {
  // Load existing tags once
  const existing = await db.query.tags.findMany({
    where: eq(tags.userId, userId),
    columns: { id: true, name: true },
  });
  const existingByName = new Map(
    existing.map((t) => [t.name.toLowerCase(), t.id] as const),
  );

  for (const tag of previewTags) {
    if (!tag.text) {
      errors.push({
        resource: "tag",
        sourceId: tag.sourceId,
        message: await tr("serverErrors", "api.import.tagNoName"),
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    const nameLower = tag.text.toLowerCase();
    const existingId = existingByName.get(nameLower);
    if (existingId) {
      idMapping.tags[tag.sourceId] = existingId;
      results.tags.skipped++;
      continue;
    }
    try {
      const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const [created] = await db
        .insert(tags)
        .values({ userId, organizationId: orgId, name: tag.text, color })
        .returning({ id: tags.id });
      idMapping.tags[tag.sourceId] = created.id;
      existingByName.set(nameLower, created.id);
      results.tags.imported++;
    } catch (err) {
      errors.push({
        resource: "tag",
        sourceId: tag.sourceId,
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  }
}

async function runClientsPhase(
  userId: string,
  orgId: string | null,
  previewClients: PreviewClient[],
  resolutions: Record<string, "skip" | "create_new" | "merge">,
  idMapping: IdMapping,
  results: ImportResults,
  errors: ImportError[],
): Promise<void> {
  for (const client of previewClients) {
    const resolution = resolutions[client.sourceId] ?? "create_new";

    // If there's a conflict and user chose skip or merge, reuse existing.
    // Both map to the existing client — the difference is the counter.
    if (client.conflict && (resolution === "skip" || resolution === "merge")) {
      idMapping.clients[client.sourceId] = client.conflict.existingClientId;
      if (resolution === "skip") {
        results.clients.skipped++;
      } else {
        results.clients.merged++;
      }
      continue;
    }

    // Create new client
    try {
      const [created] = await db
        .insert(clients)
        .values({
          userId,
          organizationId: orgId,
          name: client.name ?? "Unnamed",
          cvrNumber: client.vatNumber,
          defaultHourlyRate:
            client.defaultRate != null ? String(client.defaultRate) : null,
        })
        .returning({ id: clients.id });
      idMapping.clients[client.sourceId] = created.id;
      results.clients.imported++;
    } catch (err) {
      errors.push({
        resource: "client",
        sourceId: client.sourceId,
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  }
}

async function runProjectsPhase(
  userId: string,
  orgId: string | null,
  previewProjects: PreviewProject[],
  resolutions: Record<string, "skip" | "create_new" | "merge">,
  idMapping: IdMapping,
  results: ImportResults,
  errors: ImportError[],
): Promise<void> {
  for (const project of previewProjects) {
    const resolution = resolutions[project.sourceId] ?? "create_new";

    if (project.conflict && (resolution === "skip" || resolution === "merge")) {
      idMapping.projects[project.sourceId] = project.conflict.existingProjectId;
      if (resolution === "skip") {
        results.projects.skipped++;
      } else {
        results.projects.merged++;
      }
      continue;
    }

    // Resolve parent client
    const clientId = idMapping.clients[project.sourceCustomerId];
    if (!clientId) {
      errors.push({
        resource: "project",
        sourceId: project.sourceId,
        message: `Parent client ${project.sourceCustomerId} not mapped`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    try {
      const [created] = await db
        .insert(projects)
        .values({
          userId,
          organizationId: orgId,
          clientId,
          name: project.name ?? "Unnamed",
          hourlyRate: project.rate != null ? String(project.rate) : null,
          status: project.finishedAt ? "completed" : "active",
        })
        .returning({ id: projects.id });
      idMapping.projects[project.sourceId] = created.id;
      results.projects.imported++;
    } catch (err) {
      errors.push({
        resource: "project",
        sourceId: project.sourceId,
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  }
}

async function runEntriesPhase(
  importRow: typeof imports.$inferSelect,
  orgId: string | null,
  client: ReturnType<typeof createTimeOpsClient>,
  idMapping: IdMapping,
  results: ImportResults,
  errors: ImportError[],
): Promise<void> {
  const pageSize = 100;
  const totalEntries = importRow.totalEntries;
  if (totalEntries === 0) return;

  const totalPages = Math.ceil(totalEntries / pageSize);

  // Resume from last processed page if the cron was restarted mid-import.
  const startPage = (importRow.lastProcessedPage ?? -1) + 1;
  let processed = importRow.processedEntries ?? 0;

  // Scope dedupe pre-load to the import's date range to avoid loading
  // the user's entire time-entry history into memory (H2).
  const previewData = importRow.previewData as PreviewData;
  const dateConditions = [eq(timeEntries.userId, importRow.userId)];
  if (previewData?.dateRange) {
    dateConditions.push(
      gte(timeEntries.date, new Date(previewData.dateRange.from)),
    );
    dateConditions.push(
      lte(timeEntries.date, new Date(previewData.dateRange.to)),
    );
  }

  const existingEntries = await db.query.timeEntries.findMany({
    where: and(...dateConditions),
    columns: {
      date: true,
      hours: true,
      description: true,
      projectId: true,
      startTime: true,
      endTime: true,
    },
  });
  const existingHashes = new Set(
    existingEntries.map((e) =>
      hashEntry({
        date: toCopenhagenDateStr(new Date(e.date)),
        hours: e.hours,
        description: e.description ?? "",
        projectId: e.projectId ?? null,
        startTime: e.startTime ? e.startTime.toISOString() : null,
        endTime: e.endTime ? e.endTime.toISOString() : null,
      }),
    ),
  );

  for (let page = startPage; page < totalPages; page++) {
    // Check for cancellation every page so the user doesn't have to wait
    // for the entire import to finish.
    const freshRow = await db.query.imports.findFirst({
      where: eq(imports.id, importRow.id),
      columns: { status: true },
    });
    if (freshRow?.status === "cancelled") {
      console.warn(`[Cron][import] Import ${importRow.id} cancelled by user`);
      return;
    }

    let batch: TimeOpsRegistration[];
    try {
      const result = await client.listRegistrations({ page, pageSize });
      batch = result.items;
    } catch (err) {
      errors.push({
        resource: "entry",
        message: `Failed to fetch page ${page}: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    for (const entry of batch) {
      try {
        await processEntry(
          importRow.userId,
          orgId,
          entry,
          idMapping,
          existingHashes,
          results,
          errors,
        );
      } catch (err) {
        errors.push({
          resource: "entry",
          sourceId: String(entry.id),
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
        results.entries.failed++;
      }
      processed++;
    }

    // Update progress + lastProcessedPage after each page
    await db
      .update(imports)
      .set({
        processedEntries: processed,
        importedEntries: results.entries.imported,
        skippedEntries: results.entries.skipped,
        failedEntries: results.entries.failed,
        lastProcessedPage: page,
        results,
        errors,
        updatedAt: new Date(),
      })
      .where(eq(imports.id, importRow.id));
  }
}

async function processEntry(
  userId: string,
  orgId: string | null,
  entry: TimeOpsRegistration,
  idMapping: IdMapping,
  existingHashes: Set<string>,
  results: ImportResults,
  errors: ImportError[],
): Promise<void> {
  // Validate duration
  if (!entry.stoppedAt) {
    errors.push({
      resource: "entry",
      sourceId: String(entry.id),
      message: "Registration not stopped (still running)",
      timestamp: new Date().toISOString(),
    });
    results.entries.failed++;
    return;
  }

  const started = new Date(entry.startedAt);
  const stopped = new Date(entry.stoppedAt);
  const durationMs = stopped.getTime() - started.getTime();

  // M2: Guard against NaN from invalid date strings. NaN <= 0 is false,
  // so without this check "NaN" would be stored as hours in the DB.
  if (Number.isNaN(durationMs) || durationMs <= 0) {
    errors.push({
      resource: "entry",
      sourceId: String(entry.id),
      message: Number.isNaN(durationMs)
        ? `Invalid date format: startedAt=${entry.startedAt}, stoppedAt=${entry.stoppedAt}`
        : "Invalid duration (stop before start)",
      timestamp: new Date().toISOString(),
    });
    results.entries.failed++;
    return;
  }

  const hours = Math.max(0.01, durationMs / 3_600_000).toFixed(2);

  // Map project. Domain rule: "Time entries must link to a project".
  // If the TimeOps entry has no project, assign to a shared catch-all
  // project so the entry is still usable in reports and invoicing.
  let projectId: string | null = null;
  let clientId: string | null = null;
  if (entry.projectId != null) {
    const mapped = idMapping.projects[String(entry.projectId)];
    if (!mapped) {
      errors.push({
        resource: "entry",
        sourceId: String(entry.id),
        message: `Project ${entry.projectId} not mapped`,
        timestamp: new Date().toISOString(),
      });
      results.entries.failed++;
      return;
    }
    projectId = mapped;
  } else {
    // H3: Create or reuse a catch-all project for orphan entries.
    projectId = await getOrCreateCatchAllProject(userId, orgId, idMapping);
  }

  // Resolve client from the project
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { clientId: true },
  });
  clientId = project?.clientId ?? null;

  // Dedupe check (H4: includes startTime+endTime, uses crypto hash)
  // Dansk dato for starttidspunktet, uanset processens TZ (#649/#650)
  const date = toCopenhagenDateStr(started);
  const description = entry.description ?? "Imported from TimeOps";
  const hash = hashEntry({
    date,
    hours,
    description,
    projectId,
    startTime: started.toISOString(),
    endTime: stopped.toISOString(),
  });
  if (existingHashes.has(hash)) {
    results.entries.skipped++;
    return;
  }

  // Calculate billable rate
  const billableRate = await getRateForTimeEntry(
    db,
    userId,
    projectId,
    clientId,
    orgId,
    started,
  );

  // Insert entry
  const [inserted] = await db
    .insert(timeEntries)
    .values({
      userId,
      organizationId: orgId,
      projectId,
      clientId,
      description,
      date: entryDateFromStr(date),
      hours,
      startTime: started,
      endTime: stopped,
      billableRate,
      isBillable: entry.billable,
      source: "import",
    })
    .returning({ id: timeEntries.id });

  // Attach tags
  if (entry.tags && entry.tags.length > 0) {
    const tagRows = entry.tags
      .map((t) => idMapping.tags[String(t)])
      .filter((id): id is string => typeof id === "string")
      .map((tagId) => ({
        entryId: inserted.id,
        tagId,
        inherited: false,
      }));
    if (tagRows.length > 0) {
      await db.insert(timeEntryTags).values(tagRows);
    }
  }

  existingHashes.add(hash);
  results.entries.imported++;
}

/**
 * Get or create a "TimeOps Import" catch-all project for entries that
 * have no project in TimeOps. Uses idMapping to cache across entries.
 */
async function getOrCreateCatchAllProject(
  userId: string,
  orgId: string | null,
  idMapping: IdMapping,
): Promise<string> {
  const CATCH_ALL_KEY = "__no_project__";
  if (idMapping.projects[CATCH_ALL_KEY]) {
    return idMapping.projects[CATCH_ALL_KEY];
  }

  // Check if we already created one in a previous run
  const existing = await db.query.projects.findFirst({
    where: and(
      eq(projects.userId, userId),
      eq(projects.name, "TimeOps Import (ingen projekt)"),
    ),
    columns: { id: true },
  });
  if (existing) {
    idMapping.projects[CATCH_ALL_KEY] = existing.id;
    return existing.id;
  }

  // Need a client too — get or create a catch-all client
  let catchAllClientId = idMapping.clients[CATCH_ALL_KEY];
  if (!catchAllClientId) {
    const existingClient = await db.query.clients.findFirst({
      where: and(
        eq(clients.userId, userId),
        eq(clients.name, "TimeOps Import"),
      ),
      columns: { id: true },
    });
    if (existingClient) {
      catchAllClientId = existingClient.id;
    } else {
      const [created] = await db
        .insert(clients)
        .values({ userId, organizationId: orgId, name: "TimeOps Import" })
        .returning({ id: clients.id });
      catchAllClientId = created.id;
    }
    idMapping.clients[CATCH_ALL_KEY] = catchAllClientId;
  }

  const [created] = await db
    .insert(projects)
    .values({
      userId,
      organizationId: orgId,
      clientId: catchAllClientId,
      name: "TimeOps Import (ingen projekt)",
      status: "active",
    })
    .returning({ id: projects.id });
  idMapping.projects[CATCH_ALL_KEY] = created.id;
  return created.id;
}

function hashEntry(entry: {
  date: string;
  hours: string;
  description: string;
  projectId: string | null;
  startTime: string | null;
  endTime: string | null;
}): string {
  // Include startTime/endTime for much better uniqueness. Previously
  // only date+hours+description+project were hashed, which collided on
  // generic entries like "Meeting" at the same rounded duration.
  // Using createHash avoids delimiter-collision issues with plain concat.
  const { createHash } = require("node:crypto");
  return createHash("sha256")
    .update(
      `${entry.date}\0${entry.hours}\0${entry.description}\0${entry.projectId ?? ""}\0${entry.startTime ?? ""}\0${entry.endTime ?? ""}`,
    )
    .digest("hex")
    .slice(0, 16);
}
