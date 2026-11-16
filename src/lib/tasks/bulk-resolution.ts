import { createHash } from "node:crypto";
import { sharedT } from "@/i18n/shared-text";

export type TaskBulkResolution = "irrelevant" | "resolved";
export type TaskBulkResolutionStatus = "backlog" | "todo" | "in_progress";

export interface TaskBulkResolutionRequest {
  id: string;
  expectedStatus: TaskBulkResolutionStatus;
}

export interface TaskBulkResolutionRow {
  id: string;
  title: string;
  status: string;
  statusId: string | null;
  sourceType: string | null;
  emailRelevanceFeedback: string | null;
  completedAt: Date | null;
  updatedAt: Date;
}

interface TaskBulkResolutionState {
  status: string;
  emailRelevanceFeedback: string | null;
}

export interface TaskBulkResolutionPreviewItem {
  id: string;
  title: string;
  sourceType: string | null;
  before: TaskBulkResolutionState;
  after: TaskBulkResolutionState;
}

export interface TaskBulkResolutionPreview {
  version: 1;
  resolution: TaskBulkResolution;
  count: number;
  hash: string;
  items: TaskBulkResolutionPreviewItem[];
}

function canonicalTimestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function buildTaskBulkResolutionPreview(input: {
  requested: readonly TaskBulkResolutionRequest[];
  rows: readonly TaskBulkResolutionRow[];
  resolution: TaskBulkResolution;
}): TaskBulkResolutionPreview {
  const requestedIds = input.requested.map((task) => task.id);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Error(sharedT("sharedLabels", "bulkTasks.duplicateIds"));
  }

  const expectedById = new Map(
    input.requested.map((task) => [task.id, task.expectedStatus]),
  );
  const rowsById = new Map(input.rows.map((task) => [task.id, task]));
  const missingIds = requestedIds.filter((id) => !rowsById.has(id));

  if (missingIds.length > 0 || input.rows.length !== input.requested.length) {
    throw new Error(
      sharedT("sharedLabels", "bulkTasks.missing", {
        ids:
          missingIds.join(", ") ||
          sharedT("sharedLabels", "bulkTasks.unexpectedRowCount"),
      }),
    );
  }

  const unexpectedRows = input.rows.filter((row) => !expectedById.has(row.id));
  if (unexpectedRows.length > 0) {
    throw new Error(sharedT("sharedLabels", "bulkTasks.unselected"));
  }

  const sortedRows = [...input.rows].sort((a, b) => a.id.localeCompare(b.id));
  for (const row of sortedRows) {
    const expectedStatus = expectedById.get(row.id);
    if (row.status !== expectedStatus) {
      throw new Error(
        sharedT("sharedLabels", "bulkTasks.statusMismatch", {
          id: row.id,
          status: row.status,
          expected: String(expectedStatus),
        }),
      );
    }
    if (row.sourceType !== "email") {
      throw new Error(
        sharedT("sharedLabels", "bulkTasks.notEmail", { id: row.id }),
      );
    }
    if (row.statusId !== null) {
      throw new Error(
        sharedT("sharedLabels", "bulkTasks.customLane", { id: row.id }),
      );
    }
  }

  const canonicalSnapshot = {
    version: 1,
    resolution: input.resolution,
    items: sortedRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      statusId: row.statusId,
      sourceType: row.sourceType,
      emailRelevanceFeedback: row.emailRelevanceFeedback,
      completedAt: canonicalTimestamp(row.completedAt),
      updatedAt: canonicalTimestamp(row.updatedAt),
    })),
  } as const;

  const hash = createHash("sha256")
    .update(JSON.stringify(canonicalSnapshot))
    .digest("hex");

  return {
    version: 1,
    resolution: input.resolution,
    count: sortedRows.length,
    hash,
    items: sortedRows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceType: row.sourceType,
      before: {
        status: row.status,
        emailRelevanceFeedback: row.emailRelevanceFeedback,
      },
      after: {
        status: "done",
        emailRelevanceFeedback:
          input.resolution === "irrelevant"
            ? "irrelevant"
            : row.emailRelevanceFeedback,
      },
    })),
  };
}

export function assertTaskBulkResolutionHash(
  preview: TaskBulkResolutionPreview,
  expectedHash: string,
): void {
  if (preview.hash !== expectedHash) {
    throw new Error(
      "Dry-run er forældet. Kør dry-run igen og godkend den nye hash.",
    );
  }
}
