import { normalizeTaskList } from './normalize-task-list';

const rows = [{ id: 'task-1' }];

it('normalizes the legacy task array', () => {
  expect(normalizeTaskList(rows)).toEqual({ rows, nextCursor: null, total: 1 });
});

it('preserves the rows, cursor and total from a paginated response', () => {
  const page = { rows, nextCursor: { id: 'task-1' }, total: 101 };
  expect(normalizeTaskList(page)).toEqual(page);
});

it('normalizes an empty task array and missing query data', () => {
  const empty = { rows: [], nextCursor: null, total: 0 };
  expect(normalizeTaskList([])).toEqual(empty);
  expect(normalizeTaskList(undefined)).toEqual(empty);
  expect(normalizeTaskList(empty)).toEqual(empty);
});
