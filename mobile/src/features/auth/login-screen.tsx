import type { Busy, Provider } from './use-login';
import { Link, useRouter } from 'expo-router';
import * as React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import {
  Button,
  FocusAwareStatusBar,
  Input,
  SafeAreaView,
  Text,
  View,
} from '~/components/ui';
import { localStore } from '~/features/local/local-store';
import { isTimeWren, timewrenBrand } from '~/features/server/server-config';
import { ServerSelector } from '~/features/server/server-selector';
import { translate } from '~/lib/i18n';
import { AppleSignInButton } from './components/apple-button';
import { useSocialProviders } from './social-providers';
import { useLogin } from './use-login';

// Apple 4.8: Sign in with Apple tilbydes via AppleSignInButton (native) øverst på iOS.
const SOCIAL_LOGIN_ENABLED = !isTimeWren;

export function LoginScreen() {
  const login = useLogin();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FocusAwareStatusBar />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <Header />
          <ServerSelector />
          {login.linkSent
            ? <LinkSent email={login.email} onReset={login.resetLink} />
            : (
                <View>
                  {isTimeWren ? <Text className="mb-3 text-sm text-muted-foreground" tx="server.password_hint" /> : null}
                  <EmailForm {...login} />
                  {SOCIAL_LOGIN_ENABLED ? <SocialButtons busy={login.busy} onPress={login.signInSocial} /> : null}
                </View>
              )}
          <Link href="/signup" replace asChild>
            <Text className="mt-auto pt-10 text-center text-sm text-primary-600 dark:text-primary-400" tx="auth.no_account_hint" />
          </Link>
          <WithoutAccount />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Vej tilbage til (eller ind i) "uden konto"-tilstanden — Apple 5.1.1: login må ikke være et krav for kernefunktionen. */
function WithoutAccount() {
  const router = useRouter();
  const go = () => {
    localStore().enable();
    if (router.canGoBack())
      router.back();
    else
      router.replace('/local');
  };
  return <Text className="mt-4 text-center text-sm text-muted-foreground" onPress={go} tx="auth.continue_without_account" accessibilityHint={translate('auth.continue_without_account_hint')} testID="login-without-account" />;
}

function Header() {
  return (
    <View className="mb-10 items-center">
      <Image
        source={isTimeWren ? require('../../../assets/timewren/icon.png') : require('../../../assets/icon.png')}
        style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 16 }}
        accessibilityIgnoresInvertColors
      />
      <Text className="text-3xl font-bold text-foreground">{timewrenBrand?.name ?? 'TimeTrack'}</Text>
      <Text className="mt-1 text-center text-muted-foreground" tx="auth.tagline" />
    </View>
  );
}

function LinkSent({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <View className="rounded-2xl bg-card p-5">
      <Text className="text-lg font-semibold text-foreground" tx="auth.link_sent_title" />
      <Text className="mt-1 text-muted-foreground">
        {translate('auth.link_sent_body', { email: email.trim() })}
      </Text>
      <Button
        variant="ghost"
        label={translate('auth.use_other_email')}
        onPress={onReset}
        testID="login-other-email"
      />
    </View>
  );
}

type EmailFormProps = ReturnType<typeof useLogin>;

function EmailForm(p: EmailFormProps) {
  const canSubmit = p.emailValid && p.busy === null && (!p.usePassword || p.password.length > 0);
  return (
    <View>
      <Input
        label={translate('auth.email')}
        value={p.email}
        onChangeText={p.setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        testID="login-email"
      />
      {p.usePassword
        ? (
            <Input
              label={translate('auth.password')}
              value={p.password}
              onChangeText={p.setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
              testID="login-password"
            />
          )
        : null}
      <Button
        label={translate(p.usePassword ? 'auth.sign_in' : 'auth.send_link')}
        onPress={canSubmit ? (p.usePassword ? p.signInWithPassword : p.sendMagicLink) : undefined}
        loading={p.busy === 'password' || p.busy === 'magic'}
        className={canSubmit ? '' : 'opacity-50'}
        accessibilityState={{ disabled: !canSubmit }}
        testID="login-submit"
      />
      {!isTimeWren && (
        <Button
          variant="ghost"
          size="sm"
          label={translate(p.usePassword ? 'auth.use_magic_link' : 'auth.use_password')}
          onPress={p.toggleMethod}
          testID="login-toggle-method"
        />
      )}
    </View>
  );
}

function SocialButtons({ busy, onPress }: { busy: Busy; onPress: (p: Provider) => void }) {
  const providers = useSocialProviders();
  return (
    <View>
      <View className="my-6 flex-row items-center">
        <View className="h-px flex-1 bg-border" />
        <Text className="mx-3 text-xs text-muted-foreground" tx="auth.or" />
        <View className="h-px flex-1 bg-border" />
      </View>
      <AppleSignInButton onPress={() => onPress('apple')} disabled={busy !== null} loading={busy === 'apple'} />
      {providers.map(([id, name]) => (
        <Button
          key={id}
          variant="outline"
          label={translate('auth.continue_with', { provider: name })}
          onPress={() => onPress(id)}
          loading={busy === id}
          disabled={busy !== null}
          testID={`login-${id}`}
        />
      ))}
    </View>
  );
}
