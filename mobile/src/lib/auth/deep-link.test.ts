import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { hydrateAuth } from '~/features/auth/use-auth-store';

import { subscribeAuthDeepLinks } from './deep-link';

jest.mock('expo-linking', () => ({ addEventListener: jest.fn(), getInitialURL: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('~/features/auth/use-auth-store', () => ({ hydrateAuth: jest.fn() }));
jest.mock('~/features/server/server-config', () => ({ isTimeWren: false }));

const url = 'timetrack://auth?cookie=test';
const remove = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  // Unsubscribe only uses remove from the native subscription.
  jest.mocked(Linking.addEventListener).mockReturnValue({ remove } as unknown as ReturnType<typeof Linking.addEventListener>);
});

it('fortsætter efter fejl ved opslag af startlinket', async () => {
  jest.mocked(Linking.getInitialURL).mockRejectedValue(new Error('Linking unavailable'));

  const unsubscribe = subscribeAuthDeepLinks();
  await new Promise(resolve => setImmediate(resolve));

  expect(hydrateAuth).not.toHaveBeenCalled();
  unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('håndterer en fejl under behandling af et modtaget auth-link', async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValue(null);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('SecureStore unavailable'));

  const unsubscribe = subscribeAuthDeepLinks();
  const listener = jest.mocked(Linking.addEventListener).mock.calls[0][1];
  listener({ url });
  await new Promise(resolve => setImmediate(resolve));

  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  expect(hydrateAuth).not.toHaveBeenCalled();
  unsubscribe();
});
