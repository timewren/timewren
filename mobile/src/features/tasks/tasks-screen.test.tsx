import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { fireEvent, render, screen } from '~/lib/test-utils';
import { TasksScreen } from './tasks-screen';

const mockQuery = jest.fn();

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => String(error),
  trpc: {
    useUtils: () => ({ client: { tasks: { list: { query: (...args: unknown[]) => mockQuery(...args) } } }, tasks: { invalidate: jest.fn() } }),
    tasks: {
      list: {},
      getTodaysFocus: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }) },
      quickAdd: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) },
      markDone: { useMutation: () => ({ mutate: jest.fn() }) },
      reopen: { useMutation: () => ({ mutate: jest.fn() }) },
      delete: { useMutation: () => ({ mutate: jest.fn() }) },
    },
    projects: { list: { useQuery: () => ({ data: [], isError: false }) } },
  },
}));

jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({ isEnabled: () => true }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

jest.mock('@trpc/react-query', () => ({
  getQueryKey: (_proc: unknown, input: unknown, type: string) => [['tasks', 'list'], { input, type }],
}));

const task = (id: string, status = 'open') => ({ id, title: `Opgave ${id}`, status, deadline: null, priority: null, project: null });

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasksScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => mockQuery.mockReset());

it('loads the next page with the cursor from the first page and hides the button at the end', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [task('a')], nextCursor: { id: 'a' }, total: 2 })
    .mockResolvedValueOnce({ rows: [task('b')], nextCursor: null, total: 2 });
  renderScreen();

  await screen.findByTestId('task-a');
  expect(mockQuery.mock.calls[0][0]).not.toHaveProperty('cursor');

  fireEvent.press(screen.getByTestId('tasks-show-more'));
  await screen.findByTestId('task-b');

  expect(mockQuery.mock.calls[1][0]).toMatchObject({ cursor: { id: 'a' } });
  expect(screen.getByTestId('task-a')).toBeTruthy();
  expect(screen.queryByTestId('tasks-show-more')).toBeNull();
});

it('shows rows once when a later page repeats a task', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [task('a')], nextCursor: { id: 'a' }, total: 2 })
    .mockResolvedValueOnce({ rows: [task('a'), task('b')], nextCursor: null, total: 2 });
  renderScreen();

  await screen.findByTestId('task-a');
  fireEvent.press(screen.getByTestId('tasks-show-more'));
  await screen.findByTestId('task-b');

  expect(screen.getAllByTestId('task-a')).toHaveLength(1);
});

it('works against the legacy array response without a show-more button', async () => {
  mockQuery.mockResolvedValueOnce([task('a')]);
  renderScreen();

  await screen.findByTestId('task-a');
  expect(screen.queryByTestId('tasks-show-more')).toBeNull();
});

it('keeps the loaded rows and swaps the button for the error state when the next page fails', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [task('a')], nextCursor: { id: 'a' }, total: 2 })
    .mockRejectedValueOnce(new Error('offline'));
  renderScreen();

  await screen.findByTestId('task-a');
  fireEvent.press(screen.getByTestId('tasks-show-more'));

  // Fejltilstanden kan være langsom at vise første gang på en travl runner, så findBy får mere end standardens 1 s.
  // Testens egen timeout (tredje argument) er sat højere, så den ikke afbryder findBy før tid.
  await screen.findByTestId('retry', undefined, { timeout: 10000 });
  expect(screen.queryByTestId('tasks-show-more')).toBeNull();
  expect(screen.getByTestId('task-a')).toBeTruthy();
}, 15000);

it('explains the empty list when the first page has no task in the segment but more pages exist', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [task('a', 'done')], nextCursor: { id: 'a' }, total: 2 });
  renderScreen();

  await screen.findByTestId('tasks-show-more');
  expect(screen.queryByTestId('task-a')).toBeNull();
  expect(screen.getByText(/Show more to keep looking|Vis flere for at søge videre/)).toBeTruthy();
});
