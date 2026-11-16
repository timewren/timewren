import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { useGenerate } from './use-generate';

const mockMutateAsync = jest.fn(async () => ({ id: 'e1' }));
const mockInvalidate = jest.fn();
const mockToast = jest.fn();

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({ recurring: { invalidate: mockInvalidate }, time: { invalidate: jest.fn() } }),
    recurring: { generate: { useMutation: () => ({ mutateAsync: mockMutateAsync }) } },
  },
}));

jest.mock('~/features/entries/use-entries', () => ({
  useInvalidateEntries: () => mockInvalidate,
}));

jest.mock('~/lib/notify', () => ({ showMessage: (...args: unknown[]) => mockToast(...args) }));

/**
 * `recurring.generate` er **ikke** idempotent: hvert kald indsætter en ny
 * `timeEntries`-række og en ny `generatedTimeEntries`-række. To tryk under en
 * ark-animation — eller et tryk, fordi det første svar er langsomt — ville så
 * registrere de samme timer to gange.
 */
function Harness() {
  const { generateRow, busyId } = useGenerate();
  return (
    <>
      <Text testID="busy">{busyId ?? ''}</Text>
      <Pressable testID="go" accessibilityRole="button" onPress={() => { void generateRow('t1'); }} />
      <Pressable testID="other" accessibilityRole="button" onPress={() => { void generateRow('t2'); }} />
    </>
  );
}

beforeEach(() => {
  mockMutateAsync.mockClear();
  mockInvalidate.mockClear();
  mockToast.mockClear();
});

afterEach(cleanup);

describe('useGenerate', () => {
  it('sender kun ét kald, når der trykkes to gange på den samme skabelon', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('go'));
    fireEvent.press(screen.getByTestId('go'));
    fireEvent.press(screen.getByTestId('go'));

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ templateId: 't1' });
  });

  it('låser pr. skabelon, så to forskellige må godt genereres samtidig', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('go'));
    fireEvent.press(screen.getByTestId('other'));

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it('rydder skabelonen og tidsposterne, fordi der kom en ny post', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('go'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('melder fejlen og frigiver låsen, så et nyt forsøg kan gå', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('netværket dræbte os') as never);
    render(<Harness />);

    fireEvent.press(screen.getByTestId('go'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' })));
    expect(screen.getByTestId('busy').props.children).toBe('');

    fireEvent.press(screen.getByTestId('go'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
  });
});
