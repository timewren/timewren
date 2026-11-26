export type TaskCursor = {
  id: string;
  position: number | null;
  priority: string | null;
  deadline: string | null;
  createdAt: string | null;
};

export const taskRestSortFields = [
  "createdAt",
  "status",
  "priority",
  "deadline",
] as const;

export async function collectTaskPages<T extends { id: string }>(
  fetchPage: (
    cursor: TaskCursor | null,
  ) => Promise<{ rows: T[]; nextCursor: TaskCursor | null }>,
): Promise<T[]> {
  const pages = [];
  let cursor: TaskCursor | null = null;
  do {
    const page = await fetchPage(cursor);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return flattenTaskPages(pages);
}

export function flattenTaskPages<T extends { id: string }>(
  pages: readonly { rows: T[] }[],
): T[] {
  const rows = new Map<string, T>();
  for (const page of pages) {
    for (const row of page.rows) {
      if (!rows.has(row.id)) rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

export function groupTaskPageRows<T extends { laneKey: string }>(rows: T[]) {
  const grouped: Record<string, T[]> = {};
  for (const row of rows) {
    grouped[row.laneKey] ??= [];
    grouped[row.laneKey].push(row);
  }
  return grouped;
}
