import { storage } from '~/lib/storage';
import { getStoredPushToken, hasDeclinedPush, markPushRegistered, releasePushForSignOut, shouldRegisterPush } from './push-registration';

const mockUnregister = jest.fn(async (_input: { token: string }) => ({ removed: true }));

jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'project' } } } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-application', () => ({ __esModule: true }));
jest.mock('expo-notifications', () => ({ AndroidImportance: { DEFAULT: 3 } }));
jest.mock('~/lib/monitoring', () => ({ capturePushFirebaseWarning: jest.fn() }));
jest.mock('~/lib/storage', () => {
  const values = new Map<string, string | boolean>();
  return {
    storage: {
      getBoolean: (key: string) => values.get(key) === true,
      getString: (key: string) => typeof values.get(key) === 'string' ? values.get(key) : undefined,
      set: (key: string, value: string | boolean) => values.set(key, value),
      remove: (key: string) => values.delete(key),
      clearAll: () => values.clear(),
    },
  };
});
jest.mock('~/lib/api', () => ({
  trpcClient: { mobile: { unregisterPushToken: { mutate: (input: { token: string }) => mockUnregister(input) } } },
}));

describe('push ved log ud', () => {
  beforeEach(() => {
    (storage as unknown as { clearAll: () => void }).clearAll();
    mockUnregister.mockClear();
  });

  it('afmelder telefonens token hos den bruger, der logger ud', async () => {
    storage.set('push.expoToken', 'ExponentPushToken[abc]');
    markPushRegistered();

    await releasePushForSignOut();

    // Ellers fik telefonen fortsat den gamle brugers push — også efter et
    // login med en anden konto.
    expect(mockUnregister).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]' });
    expect(getStoredPushToken()).toBeNull();
  });

  it('lader næste login registrere igen, uden at gemme et afslag', async () => {
    markPushRegistered();
    expect(shouldRegisterPush()).toBe(false);

    await releasePushForSignOut();

    expect(hasDeclinedPush()).toBe(false);
    expect(shouldRegisterPush()).toBe(true);
  });

  it('logger ud, selv om serveren ikke svarer', async () => {
    storage.set('push.expoToken', 'ExponentPushToken[abc]');
    mockUnregister.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(releasePushForSignOut()).resolves.toBeUndefined();
    expect(getStoredPushToken()).toBeNull();
  });
});
