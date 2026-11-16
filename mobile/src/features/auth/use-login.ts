import { useRouter } from 'expo-router';
import * as React from 'react';
import { isTimeWren } from '~/features/server/server-config';
import { isAppleCancel, signInWithApple } from '~/lib/auth/apple';
import { authClient } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { setSession } from './use-auth-store';

export type Provider = 'apple' | 'google' | 'microsoft' | 'github' | 'discord';
export type Busy = null | 'magic' | 'password' | Provider;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(e: unknown) {
  showMessage({
    message: (e as Error)?.message || translate('auth.error_generic'),
    type: 'danger',
  });
}

/**
 * Login-logik: magic link, adgangskode og social login (systembrowser via
 * better-auth's Expo-proxy). Skærmen er ren visning.
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

  const afterLogin = React.useCallback(async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      showMessage({ message: translate('auth.error_no_session'), type: 'danger' });
      return;
    }
    setSession(data);
    router.replace('/');
  }, [router]);

  const run = React.useCallback(async (kind: Busy, fn: () => Promise<void>) => {
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

  const sendMagicLink = () => run('magic', async () => {
    const { error } = await authClient.signIn.magicLink({ email: normalizedEmail, callbackURL: '/' });
    if (error)
      throw new Error(error.message);
    setLinkSent(true);
  });

  const signInWithPassword = () => run('password', async () => {
    const { error } = await authClient.signIn.email({ email: normalizedEmail, password });
    if (error)
      throw new Error(error.message);
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
    else if (provider === 'microsoft') {
      await authClient.signIn.oauth2({ providerId: 'microsoft-entra-id', callbackURL: '/' });
    }
    else {
      await authClient.signIn.social({ provider, callbackURL: '/' });
    }
    await afterLogin();
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
  };
}
