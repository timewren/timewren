import type { AuthSession } from '~/lib/auth/client';
import { act, renderHook } from '@testing-library/react-native';
import { authClient } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { useLogin } from './use-login';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
const mockShowMessage = jest.fn();
jest.mock('~/lib/notify', () => ({ showMessage: (...args: unknown[]) => mockShowMessage(...args) }));
const mockSetSession = jest.fn();
jest.mock('./use-auth-store', () => ({ setSession: (s: unknown) => mockSetSession(s) }));
jest.mock('~/features/server/server-config', () => ({ ...jest.requireActual('~/features/server/server-config'), isTimeWren: true }));
jest.mock('~/lib/auth/apple', () => ({ signInWithApple: jest.fn(), isAppleCancel: () => false }));

const session = { user: { id: 'u1' }, session: { id: 's1' } } as unknown as AuthSession;
type SignInResult = Awaited<ReturnType<typeof authClient.signIn.email>>;

function renderLogin() {
  const view = renderHook(() => useLogin());
  act(() => {
    view.result.current.setEmail('mads@example.com');
    view.result.current.setPassword('hemmelig-kode');
  });
  return view;
}

describe('useLogin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('beder om tofaktorkoden i stedet for at melde "ingen session"', async () => {
    jest.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: { twoFactorRedirect: true, twoFactorMethods: ['totp', 'otp'] }, error: null } as unknown as SignInResult);
    const { result } = renderLogin();

    await act(() => result.current.signInWithPassword());

    expect(result.current.twoFactor.twoFactor).toEqual({ mode: 'totp', methods: ['totp', 'otp'] });
    expect(mockShowMessage).not.toHaveBeenCalled();

    jest.mocked(authClient.getSession).mockResolvedValueOnce({ data: session, error: null });
    act(() => result.current.twoFactor.setCode('123 456'));
    await act(() => result.current.twoFactor.verify());

    expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(mockSetSession).toHaveBeenCalledWith(session);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('sender en mailkode, når kontoen kun har den metode', async () => {
    jest.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: { twoFactorRedirect: true, twoFactorMethods: ['otp'] }, error: null } as unknown as SignInResult);
    const { result } = renderLogin();

    await act(() => result.current.signInWithPassword());

    expect(result.current.twoFactor.twoFactor?.mode).toBe('otp');
    expect(authClient.twoFactor.sendOtp).toHaveBeenCalled();
  });

  it('viser en forkert kode som appens egen tekst', async () => {
    jest.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] }, error: null } as unknown as SignInResult);
    jest.mocked(authClient.twoFactor.verifyTotp).mockResolvedValueOnce({ error: { code: 'INVALID_CODE', message: 'Invalid code', status: 401 } } as never);
    const { result } = renderLogin();
    await act(() => result.current.signInWithPassword());
    act(() => result.current.twoFactor.setCode('000000'));
    await act(() => result.current.twoFactor.verify());

    expect(mockShowMessage).toHaveBeenCalledWith({ message: translate('auth.errors.invalid_code'), type: 'danger' });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('oversætter serverens fejlkode i stedet for at vise engelsk tekst', async () => {
    jest.mocked(authClient.signIn.email).mockResolvedValueOnce({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password', status: 401 } } as unknown as SignInResult);
    const { result } = renderLogin();

    await act(() => result.current.signInWithPassword());

    expect(mockShowMessage).toHaveBeenCalledWith({ message: translate('auth.errors.invalid_credentials'), type: 'danger' });
  });

  it('viser ingen fejl, når brugeren selv lukker browseren under socialt login', async () => {
    jest.mocked(authClient.getSession).mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderLogin();

    await act(() => result.current.signInSocial('google'));

    expect(mockShowMessage).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
