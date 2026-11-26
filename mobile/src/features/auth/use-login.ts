import type { TwoFactorMode } from './two-factor';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { isTimeWren } from '~/features/server/server-config';
import { isAppleCancel, signInWithApple } from '~/lib/auth/apple';
import { authClient } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { authErrorMessage } from './auth-errors';
import { initialTwoFactorMode, sendTwoFactorEmail, twoFactorMethods, verifyTwoFactorCode } from './two-factor';
import { setSession } from './use-auth-store';

export type Provider = 'apple' | 'google' | 'microsoft' | 'github' | 'discord';
export type Busy = null | 'magic' | 'password' | 'two_factor' | Provider;
type Run = (kind: Busy, fn: () => Promise<void>) => Promise<void>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(e: unknown) {
  showMessage({ message: authErrorMessage(e), type: 'danger' });
}

/** Tofaktor-trinnet efter en adgangskode: hvilken metode, og koden brugeren skriver. */
function useTwoFactorStep(run: Run, afterLogin: (opts?: { quiet?: boolean }) => Promise<void>) {
  const [step, setStep] = React.useState<{ mode: TwoFactorMode; methods: string[] } | null>(null);
  const [code, setCode] = React.useState('');

  const choose = React.useCallback(async (mode: TwoFactorMode, methods: string[]) => {
    setCode('');
    setStep({ mode, methods });
    if (mode !== 'otp')
      return;
    const error = await sendTwoFactorEmail();
    if (error)
      throw error;
    showMessage({ message: translate('auth.two_factor.code_sent'), type: 'success' });
  }, []);

  return {
    twoFactor: step,
    code,
    setCode,
    start: (methods: string[]) => choose(initialTwoFactorMode(methods), methods),
    switchMode: (mode: TwoFactorMode) => run('two_factor', () => choose(mode, step?.methods ?? [])),
    verify: () => run('two_factor', async () => {
      if (!step)
        return;
      const error = await verifyTwoFactorCode(step.mode, code);
      if (error)
        throw error;
      await afterLogin();
    }),
    cancel: () => {
      setStep(null);
      setCode('');
    },
  };
}

/**
 * Login-logik: magic link, adgangskode (med tofaktor) og social login
 * (systembrowser via better-auth's Expo-proxy). Skærmen er ren visning.
 */
export function useLogin() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [usePassword, setUsePassword] = React.useState(isTimeWren);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [linkSent, setLinkSent] = React.useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const normalizedEmail = email.trim().toLowerCase();

  // `quiet`: et socialt login, brugeren selv lukkede, giver heller ingen
  // session — det er ikke en fejl, der skal vises.
  const afterLogin = React.useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const { data } = await authClient.getSession();
    if (!data) {
      if (!quiet)
        showMessage({ message: translate('auth.error_no_session'), type: 'danger' });
      return;
    }
    setSession(data);
    router.replace('/');
  }, [router]);

  const run = React.useCallback<Run>(async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    }
    catch (e) {
      fail(e);
    }
    finally {
      setBusy(null);
    }
  }, []);

  const twoFactor = useTwoFactorStep(run, afterLogin);

  const sendMagicLink = () => run('magic', async () => {
    const { error } = await authClient.signIn.magicLink({ email: normalizedEmail, callbackURL: '/' });
    if (error)
      throw error;
    setLinkSent(true);
  });

  const signInWithPassword = () => run('password', async () => {
    const { data, error } = await authClient.signIn.email({ email: normalizedEmail, password });
    if (error)
      throw error;
    const methods = twoFactorMethods(data);
    if (methods)
      return twoFactor.start(methods);
    await afterLogin();
  });

  const signInSocial = (provider: Provider) => run(provider, async () => {
    if (provider === 'apple') {
      try {
        await signInWithApple();
      }
      catch (err) {
        if (isAppleCancel(err))
          return;
        throw err;
      }
    }
    else {
      const result = provider === 'microsoft'
        ? await authClient.signIn.oauth2({ providerId: 'microsoft-entra-id', callbackURL: '/' })
        : await authClient.signIn.social({ provider, callbackURL: '/' });
      if (result?.error)
        throw result.error;
    }
    await afterLogin({ quiet: provider !== 'apple' });
  });

  return {
    email,
    setEmail,
    password,
    setPassword,
    usePassword,
    toggleMethod: () => setUsePassword(v => !v),
    busy,
    linkSent,
    resetLink: () => setLinkSent(false),
    emailValid,
    sendMagicLink,
    signInWithPassword,
    signInSocial,
    twoFactor,
  };
}
