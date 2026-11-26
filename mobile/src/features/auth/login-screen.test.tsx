import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '~/lib/test-utils';
import { LoginScreen } from './login-screen';

const mockStatus = { current: 'signOut' as 'signOut' | 'signIn' };
const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: (props: { href: string }) => mockRedirect(props),
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
}));
jest.mock('./use-auth-store', () => ({
  setSession: jest.fn(),
  useAuthStore: { use: { status: () => mockStatus.current } },
}));
jest.mock('~/features/server/server-selector', () => ({ ServerSelector: () => null }));
jest.mock('./social-providers', () => ({ useSocialProviders: () => [] }));
jest.mock('./components/apple-button', () => ({ AppleSignInButton: () => null }));
jest.mock('~/lib/auth/apple', () => ({ signInWithApple: jest.fn(), isAppleCancel: () => false }));

describe('loginScreen', () => {
  afterEach(() => {
    cleanup();
    mockStatus.current = 'signOut';
    mockRedirect.mockClear();
  });

  it('går ind i appen, når et magic link logger ind, mens skærmen er åben', () => {
    mockStatus.current = 'signIn';
    render(<LoginScreen />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/' });
  });

  it('melder login-knappen deaktiveret til skærmlæseren, indtil e-mailen er gyldig', () => {
    render(<LoginScreen />);
    expect(screen.getByTestId('login-submit').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId('login-email'), 'mads@example.com');
    if (screen.queryByTestId('login-password'))
      fireEvent.changeText(screen.getByTestId('login-password'), 'hemmelig-kode');
    expect(screen.getByTestId('login-submit').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
