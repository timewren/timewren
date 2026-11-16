import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { usePark } from './use-park';

const mockPause = jest.fn(async (_args: { id: string }) => ({ id: _args.id }));
const mockResume = jest.fn(async (_args: { id: string }) => ({ id: _args.id }));
const mockToggle = jest.fn(async (_args: { id: string }) => ({ id: _args.id }));
const mockInvalidate = jest.fn();
const mockToast = jest.fn();

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({ recurring: { invalidate: mockInvalidate } }),
    recurring: {
      pause: { useMutation: () => ({ mutateAsync: mockPause }) },
      resume: { useMutation: () => ({ mutateAsync: mockResume }) },
      toggleActive: { useMutation: () => ({ mutateAsync: mockToggle }) },
    },
  },
}));

jest.mock('~/lib/notify', () => ({ showMessage: (...args: unknown[]) => mockToast(...args) }));

function Harness() {
  const { parkRow, busyId } = usePark();
  return (
    <>
      <Text testID="busy">{busyId ?? ''}</Text>
      <Pressable testID="pause" accessibilityRole="button" onPress={() => { void parkRow('t1', 'pause'); }} />
      <Pressable testID="resume" accessibilityRole="button" onPress={() => { void parkRow('t1', 'resume'); }} />
      <Pressable testID="other" accessibilityRole="button" onPress={() => { void parkRow('t2', 'pause'); }} />
      <Pressable testID="activate" accessibilityRole="button" onPress={() => { void parkRow('t3', 'activate'); }} />
    </>
  );
}

beforeEach(() => {
  mockPause.mockClear();
  mockResume.mockClear();
  mockToggle.mockClear();
  mockInvalidate.mockClear();
  mockToast.mockClear();
});

afterEach(cleanup);

describe('usePark', () => {
  /**
   * `pause` og `resume` er **flips** — henholdsvis `isPaused = true` og
   * `isPaused = false` (routeren:843 og 886). To tryk under en ark-animation
   * kunne derfor pause og genoptage i samme bevægelse: brugeren så kvitteringen
   * «sat på pause» og så skabelonen komme ud igen. Samme greb som
   * `useGenerate`'s `generateFlight`.
   */
  it('sender kun ét pause-kald, når der trykkes tre gange på den samme skabelon', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));
    fireEvent.press(screen.getByTestId('pause'));
    fireEvent.press(screen.getByTestId('pause'));

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPause).toHaveBeenCalledWith({ id: 't1' });
  });

  it('låser på handlingen, så pause og genoptagelse af samme skabelon begge kan sendes', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));
    fireEvent.press(screen.getByTestId('resume'));

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('låser pr. skabelon, så to forskellige godt må pauses samtidig', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));
    fireEvent.press(screen.getByTestId('other'));

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockPause).toHaveBeenCalledTimes(2);
  });

  /**
   * `getPending` og `list` henter begge `isPaused` og `isActive`. Uden
   * invalidering står rækken med den gamle badge, og «Klar nu» viser stadig en
   * pauset skabelon — fordi den liste svarer **serverens** filtre, ikke vores.
   */
  it('genindlæser begge lister, fordi en pause ændrer hvad de svarer', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });

  it('sender ingen dato med pausen, fordi ingen læser den', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));

    await waitFor(() => expect(mockPause).toHaveBeenCalled());
    // `pausedUntil` skrives af serveren, men cron'en og `getPending` prøver kun
    // `isPaused = false`. En feriepause med dato ville være et løfte om en
    // automatisk genoptagelse, der aldrig kommer.
    expect(mockPause.mock.calls[0][0]).toEqual({ id: 't1' });
  });

  /**
   * `toggleActive` sætter `isActive = !template.isActive` (routeren:809) — den
   * læser **serverens** værdi, ikke vores. Den er derfor den mutation der
   * værst kan vende en skabelon ved et ekstra kald, og den skal have sin egen
   * nøgle: låser den på `pause`-nøglen, kunne en pause og en tilbrug af samme
   * skabelon låse hinanden i stedet for at begge gå.
   */
  it('kalder toggleActive for «slå til», fordi den hverken pause eller genoptager', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('activate'));

    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    expect(mockToggle).toHaveBeenCalledWith({ id: 't3' });
    expect(mockPause).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it('melder fejlen og frigiver låsen, så et nyt forsøg kan gå', async () => {
    mockPause.mockRejectedValueOnce(new Error('netværket dræbte os') as never);
    render(<Harness />);

    fireEvent.press(screen.getByTestId('pause'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' })));
    expect(screen.getByTestId('busy').props.children).toBe('');

    fireEvent.press(screen.getByTestId('pause'));
    await waitFor(() => expect(mockPause).toHaveBeenCalledTimes(2));
  });
});
