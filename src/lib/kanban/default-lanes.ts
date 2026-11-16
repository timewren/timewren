/**
 * Default Kanban lane catalogs used when seeding a user's general
 * board (first access) and when creating a new project.
 *
 * Keep these in sync with the migration script — the idempotent data
 * migration seeds the same rows.
 */

import type { LaneCategory } from "./lane-category";

export interface DefaultLane {
  name: string;
  color: string;
  order: number;
  isArchive: boolean;
  category: LaneCategory;
}

/** Seeded into task_statuses with scope='general' on first access. */
export const GENERAL_DEFAULT_LANES: readonly DefaultLane[] = [
  {
    name: "Backlog",
    color: "#9ca3af",
    order: 0,
    isArchive: false,
    category: "not_started",
  },
  {
    name: "Todo",
    color: "#3b82f6",
    order: 1,
    isArchive: false,
    category: "not_started",
  },
  {
    name: "I gang",
    color: "#f59e0b",
    order: 2,
    isArchive: false,
    category: "in_progress",
  },
  {
    name: "Afsluttet",
    color: "#10b981",
    order: 3,
    isArchive: true,
    category: "done",
  },
] as const;

/** Seeded into task_statuses with scope='project' when a project is created. */
export const PROJECT_DEFAULT_LANES: readonly DefaultLane[] = [
  {
    name: "Todo",
    color: "#3b82f6",
    order: 0,
    isArchive: false,
    category: "not_started",
  },
  {
    name: "I gang",
    color: "#f59e0b",
    order: 1,
    isArchive: false,
    category: "in_progress",
  },
  {
    name: "Afsluttet",
    color: "#10b981",
    order: 2,
    isArchive: true,
    category: "done",
  },
] as const;

/**
 * Translate the legacy tasks.status varchar values to the Danish
 * names used by both default-lane catalogs. Returns null for unknown
 * values (defensive — the enum is closed).
 */
export function mapLegacyStatusToLaneName(legacy: string): string | null {
  switch (legacy) {
    case "backlog":
      return "Backlog";
    case "todo":
      return "Todo";
    case "in_progress":
      return "I gang";
    case "done":
      return "Afsluttet";
    default:
      return null;
  }
}
