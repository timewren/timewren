import { appleCodeForAccountDeletion, signInWithApple } from './apple';

const mockListAccounts = jest.fn();
const mockSignInAsync = jest.fn();
const mockCaptureError = jest.fn();

const mockSocial = jest.fn(async (_input: unknown) => ({ error: null }));
jest.mock('./client', () => ({ authClient: { listAccounts: () => mockListAccounts(), signIn: { social: (input: unknown) => mockSocial(input) } } }));
jest.mock('~/lib/monitoring', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'nonce', digestStringAsync: async () => 'hashed', CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: async () => true,
  signInAsync: (...a: unknown[]) => mockSignInAsync(...a),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

describe('signInWithApple', () => {
  beforeEach(() => {
    mockSignInAsync.mockReset();
    mockSocial.mockClear();
  });

  it('sender navnet med, som Apple kun giver ved første login', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'jwt', fullName: { givenName: 'Mads', familyName: 'Jensen' }, email: 'x@privaterelay.appleid.com' });
    await signInWithApple();
    expect(mockSocial).toHaveBeenCalledWith({
      provider: 'apple',
      idToken: { token: 'jwt', nonce: 'nonce', user: { name: { firstName: 'Mads', lastName: 'Jensen' }, email: 'x@privaterelay.appleid.com' } },
    });
  });

  it('sender intet brugerobjekt ved senere logins, hvor Apple ikke har navnet', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'jwt', fullName: { givenName: null, familyName: null }, email: null });
    await signInWithApple();
    expect(mockSocial).toHaveBeenCalledWith({ provider: 'apple', idToken: { token: 'jwt', nonce: 'nonce' } });
  });
});

describe('appleCodeForAccountDeletion', () => {
  beforeEach(() => {
    mockListAccounts.mockReset();
    mockSignInAsync.mockReset();
    mockCaptureError.mockReset();
  });

  it('henter en frisk kode, når kontoen har Apple-login', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'credential' }, { providerId: 'apple' }], error: null });
    mockSignInAsync.mockResolvedValue({ authorizationCode: 'code-1' });
    await expect(appleCodeForAccountDeletion()).resolves.toBe('code-1');
  });

  it('spørger ikke Apple, når kontoen ikke har Apple-login', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'google' }], error: null });
    await expect(appleCodeForAccountDeletion()).resolves.toBeNull();
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });

  it('melder annulleret, når brugeren lukker Apple-arket', async () => {
    mockListAccounts.mockResolvedValue({ data: [{ providerId: 'apple' }], error: null });
    mockSignInAsync.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    await expect(appleCodeForAccountDeletion()).resolves.toBe('canceled');
  });

  it('rapporterer en fejl fra listAccounts i stedet for at tie den ihjel', async () => {
    mockListAccounts.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } });
    await expect(appleCodeForAccountDeletion()).resolves.toBeNull();
    expect(mockCaptureError).toHaveBeenCalled();
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });
});
