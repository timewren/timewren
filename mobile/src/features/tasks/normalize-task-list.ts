type TaskListPage<Row, Cursor> = {
  rows: Row[];
  nextCursor: Cursor | null;
  total: number | undefined;
};

export function normalizeTaskList<Row, Cursor>(
  data: Row[] | TaskListPage<Row, Cursor> | undefined,
): TaskListPage<Row, Cursor> {
  if (data && !Array.isArray(data))
    return data;

  const rows = data ?? [];
  return { rows, nextCursor: null, total: rows.length };
}
