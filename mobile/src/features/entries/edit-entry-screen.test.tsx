import type { TimeEntryDetail } from './use-entries';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { EditEntryScreen } from './edit-entry-screen';

/**
 * `time.update` tager **ikke** imod tags — serveren sætter kun nedarvede
 * tags ved oprettelse. Derfor er tags et *efter*-kald (`tags.setForEntry`),
 * og det lå i `meta` på kø-elementet. Uden det tabte en offline-redigering
 * brugerens valgte tags helt stille: kvitteringen sagde «Gemt», `router.back()`
 * kørte, og ingen fik besked — modsat online-stien, der melder fejlen.
 */

const mockEnqueue: unknown[] = [];
const mockSetTags = jest.fn(async () => ({ success: true }));

jest.mock('~/features/offline/run-or-queue', () => ({
  runOrQueue: async (mutation: unknown) => {
    mockEnqueue.push(mutation);
    return { kind: 'queued' };
  },
}));

jest.mock('./apply-tags', () => ({ applyTagsToEntry: (...args: unknown[]) => mockSetTags(...(args as [])) }));

// Formularen er et helt skærmbillede med egne kalde; her dømmes kun den
// mutation skærmen lægger i køen. Knapperne danner deres egen form-state.
jest.mock('./entry-form', () => {
  const { Pressable } = jest.requireActual('react-native');
  const { createElement, Fragment } = jest.requireActual('react');
  return {
    EntryForm: (props: { onChange: (p: { tagIds: string[] }) => void; onSubmit: () => void }) => createElement(Fragment, null, [
      createElement(Pressable, { key: 'a', testID: 'stub-add-tag', accessibilityRole: 'button', onPress: () => props.onChange({ tagIds: ['t2'] }) }),
      createElement(Pressable, { key: 'r', testID: 'stub-remove-tag', accessibilityRole: 'button', onPress: () => props.onChange({ tagIds: [] }) }),
      createElement(Pressable, { key: 's', testID: 'stub-submit', accessibilityRole: 'button', onPress: () => props.onSubmit() }),
    ]),
  };
});

jest.mock('./use-entries', () => ({
  confirmDelete: jest.fn(),
  showApiError: jest.fn(),
  useEntryActions: () => ({ duplicate: jest.fn(), duplicatePending: false, removeOrQueue: jest.fn(), remove: { isPending: false } }),
  useInvalidateEntries: () => jest.fn(),
}));

jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({ isEnabled: () => false, isManager: false }),
}));

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    time: {
      getById: { useQuery: () => ({ data: mockEntry(), isLoading: false, isError: false, error: null, refetch: jest.fn() }) },
      update: { useMutation: () => ({ mutateAsync: jest.fn(), isPending: false }) },
    },
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'e1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

/** Manuelt valgte tags på den post, der redigeres (t1), uden nedarvede. */
function mockEntry(): TimeEntryDetail {
  return {
    id: 'e1',
    date: '2026-10-01',
    hours: '3',
    description: 'Gæster',
    isBillable: true,
    notes: null,
    startTime: null,
    endTime: null,
    clientId: null,
    projectId: null,
    taskId: null,
    prepaidPackageId: null,
    project: null,
    tags: [{ id: 't1', name: 'Køkken', inherited: false }, { id: 't9', name: 'Kunde', inherited: true }],
  } as unknown as TimeEntryDetail;
}

type Queued = { type: string; meta?: { tagIds?: string[] } };

/** Tryk Gem efter at have trykket på en af tag-knapperne. */
async function gem(tryk: 'add' | 'remove' | 'none') {
  render(<EditEntryScreen />);
  if (tryk === 'add')
    fireEvent.press(screen.getByTestId('stub-add-tag'));
  if (tryk === 'remove')
    fireEvent.press(screen.getByTestId('stub-remove-tag'));
  fireEvent.press(screen.getByTestId('stub-submit'));
  await waitFor(() => expect(mockEnqueue).toHaveLength(1));
  return mockEnqueue[0] as Queued;
}

beforeEach(() => {
  mockEnqueue.length = 0;
  mockSetTags.mockClear();
});

afterEach(cleanup);

describe('tags på en redigeret post', () => {
  it('lægger de valgte tags i kø-elementets meta', async () => {
    const queued = await gem('add');
    expect(queued.type).toBe('time.update');
    expect(queued.meta?.tagIds).toEqual(['t2']);
  });

  it('køer en tom liste, når brugeren fjernede alle tags', async () => {
    // `undefined` betyder «intet ændret», `[]` betyder «fjern alle» — de to må
    // ikke smelte sammen, ellers beholder posten de tags brugeren tog af.
    const queued = await gem('remove');
    expect(queued.meta?.tagIds).toEqual([]);
  });

  it('sætter ingen meta, når rettelsen ikke rørte tags', async () => {
    const queued = await gem('none');
    expect(queued.meta).toBeUndefined();
  });
});
