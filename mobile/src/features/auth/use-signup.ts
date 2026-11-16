import type { Provider } from './use-login';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { isAppleCancel, signInWithApple } from '~/lib/auth/apple';
import { authClient } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { setSession } from './use-auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

type Busy = null | 'email' | Provider;

/**
 * Oprettelse i appen: navn + e-mail + adgangskode → backenden sender en
 * verifikationsmail; linket åbner appen (deep link med sessionscookie).
 * Social oprettelse logger ind med det samme. Backenden opretter automatisk
 * en personlig organisation (createPersonalWorkspace) ved ny bruger.
 */
export function useSignup() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState<Busy>(null);
  const [sent, setSent] = React.useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const nameValid = name.trim().length >= 2;
  const passwordValid = password.length >= MIN_PASSWORD;
  const canSubmit = emailValid && nameValid && passwordValid && busy === null;

  const run = React.useCallback(async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    }
    catch (e) {
      showMessage({ message: (e as Error)?.message || translate('auth.error_generic'), type: 'danger' });
    }
    finally {
      setBusy(null);
    }
  }, []);

  const signUpWithEmail = () => run('email', async () => {
    const { error } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      callbackURL: '/',
    });
    if (error)
      throw new Error(error.message);
    setSent(true);
  });

  const signUpSocial = (provider: Provider) => run(provider, async () => {
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
    const { data } = await authClient.getSession();
    if (!data)
      throw new Error(translate('auth.error_no_session'));
    setSession(data);
    router.replace('/');
  });

  return {
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    busy,
    sent,
    emailValid,
    nameValid,
    passwordValid,
    canSubmit,
    signUpWithEmail,
    signUpSocial,
  };
}
