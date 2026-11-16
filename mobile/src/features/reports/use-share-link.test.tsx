import * as React from 'react';
import { Pressable, Share, Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { CREATING, useShareLink } from './use-share-link';

/**
 * De to mutationer der deler en rapport, er **ikke** idempotent, så begge er
 * låst pr. nøgle. Denne test kalder dem direkte — ikke gennem en knap, fordi
 * RNTL springer tryk over på en knap der er `disabled`, og `Button` sætter selv
 * `disabled` mens `loading`. En test gennem knappen ville derfor aldrig nå låsen.
 */

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockInvalidate = jest.fn();
const mockToast = jest.fn();
let mockShare: jest.SpyInstance;

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({ reports: { invalidate: mockInvalidate } }),
    reports: {
      createShareLink: { useMutation: () => ({ mutateAsync: mockCreate }) },
      revokeShareLink: { useMutation: () => ({ mutateAsync: mockRevoke }) },
    },
  },
}));

jest.mock('~/lib/notify', () => ({ showMessage: (...args: unknown[]) => mockToast(...args) }));

const INPUT = { config: { columns: ['hours'] }, name: 'Oktober', lockDates: true } as never;

function Harness() {
  const { createLink, revokeLink, busyId } = useShareLink();
  return (
    <>
      <Text testID="busy">{busyId ?? ''}</Text>
      <Pressable testID="create" accessibilityRole="button" onPress={() => { void createLink(INPUT); }} />
      <Pressable testID="revoke-l1" accessibilityRole="button" onPress={() => { void revokeLink('l1'); }} />
      <Pressable testID="revoke-l2" accessibilityRole="button" onPress={() => { void revokeLink('l2'); }} />
    </>
  );
}

/** Et kald der står åbent, indtil testen lukker det. */
function udenSvar() {
  let luk: (v: unknown) => void = () => {};
  const promise = new Promise((resolve) => {
    luk = resolve;
  });
  return { promise, luk };
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ id: 'nyt', url: 'https://x/r/nyt', name: 'Oktober', token: 't', lockedDates: true });
  mockRevoke.mockReset().mockResolvedValue({ success: true });
  mockInvalidate.mockReset();
  mockToast.mockReset();
  mockShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createShareLink', () => {
  /**
   * Hvert kald indsætter en ny `report_shares`-række med sit eget token
   * (routeren: `crypto.randomBytes(32)` + insert). Tre tryk under ét kald gav
   * tre rapporter, og brugeren fik kun den første — de to andre lå som
   * rapporten ingen vidste om, med en URL ingen har set.
   */
  it('sender ét kald, selv om der trykkes tre gange mens det første er i gang', async () => {
    const { promise, luk } = udenSvar();
    mockCreate.mockImplementation(() => promise);
    render(<Harness />);

    fireEvent.press(screen.getByTestId('create'));
    fireEvent.press(screen.getByTestId('create'));
    fireEvent.press(screen.getByTestId('create'));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('busy')).toHaveTextContent(CREATING);

    luk({ id: 'nyt', url: 'https://x/r/nyt', name: 'Oktober', token: 't', lockedDates: true });

    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Delingen ligger i låsen: ét link, ét share-ark — ellers ville det andet
    // tryk få samme promise og åbne et ark til for det samme link.
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith({ message: 'Oktober\nhttps://x/r/nyt' });
  });

  /**
   * Listen er kontoens egen, så både et nyt link og et tilbagekaldt skal kunne
   * ses uden at brugeren trækker for at genindlæse.
   */
  it('genindlæser rapports, så det nye link kan ses blandt de andre', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('create'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });

  it('åbner intet share-ark når serveren afviser', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Serveren afviste navnet') as never);
    render(<Harness />);

    fireEvent.press(screen.getByTestId('create'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ message: 'Serveren afviste navnet', type: 'danger' }));
    expect(screen.getByTestId('busy').props.children).toBe('');
    expect(mockShare).not.toHaveBeenCalled();

    // Låsen skal være frigivet, ellers kan brugeren ikke prøve igen.
    fireEvent.press(screen.getByTestId('create'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  });
});

describe('revokeShareLink', () => {
  /**
   * `revokeShareLink` matcher kun rækker med `revokedAt IS NULL`, så det andet
   * kald kaster `NOT_FOUND` — brugeren så en rød fejl efter en handling der
   * lykkedes, og linket forsvandt alligevel.
   */
  it('sender ét kald pr. link, selv om der trykkes to gange', async () => {
    const { promise, luk } = udenSvar();
    mockRevoke.mockImplementation(() => promise);
    render(<Harness />);

    fireEvent.press(screen.getByTestId('revoke-l1'));
    fireEvent.press(screen.getByTestId('revoke-l1'));

    expect(mockRevoke).toHaveBeenCalledTimes(1);

    luk({ success: true });
    await waitFor(() => expect(screen.getByTestId('busy').props.children).toBe(''));
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  it('låser pr. link, så to forskellige godt må forsvinde samtidig', async () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId('revoke-l1'));
    fireEvent.press(screen.getByTestId('revoke-l2'));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledTimes(2));
    expect(mockRevoke).toHaveBeenCalledWith({ id: 'l1' });
    expect(mockRevoke).toHaveBeenCalledWith({ id: 'l2' });
  });
});
