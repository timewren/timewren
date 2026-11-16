import { Link } from 'expo-router';
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import {
  Button,
  FocusAwareStatusBar,
  Input,
  SafeAreaView,
  Text,
  View,
} from '~/components/ui';
import { isTimeWren } from '~/features/server/server-config';
import { ServerSelector } from '~/features/server/server-selector';
import { translate } from '~/lib/i18n';
import { AppleSignInButton } from './components/apple-button';
import { useSocialProviders } from './social-providers';
import { MIN_PASSWORD, useSignup } from './use-signup';

// Apple 4.8: Sign in with Apple tilbydes via AppleSignInButton (native) på iOS.
const SOCIAL_LOGIN_ENABLED = !isTimeWren;

export function SignupScreen() {
  const s = useSignup();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <FocusAwareStatusBar />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
          <Text className="text-3xl font-bold text-foreground" tx="auth.signup.title" />
          <Text className="mt-1 mb-6 text-muted-foreground" tx="auth.signup.subtitle" />
          <ServerSelector />
          {s.sent
            ? (
                <View className="rounded-2xl bg-card p-5">
                  <Text className="text-lg font-semibold text-foreground" tx="auth.signup.sent_title" />
                  <Text className="mt-1 text-muted-foreground">{translate(isTimeWren ? 'auth.signup.sent_body_timewren' : 'auth.signup.sent_body', { email: s.email.trim() })}</Text>
                </View>
              )
            : <Form {...s} />}
          <Link href="/login" replace asChild>
            <Text className="mt-8 text-center text-sm text-primary-600 dark:text-primary-400" tx="auth.signup.have_account" />
          </Link>
          <Text className="mt-6 text-center text-xs text-muted-foreground" tx="auth.signup.terms" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Form(s: ReturnType<typeof useSignup>) {
  return (
    <View>
      <Input label={translate('auth.signup.name')} value={s.name} onChangeText={s.setName} autoComplete="name" textContentType="name" testID="signup-name" />
      <Input label={translate('auth.email')} value={s.email} onChangeText={s.setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" testID="signup-email" />
      <Input
        label={translate('auth.password')}
        value={s.password}
        onChangeText={s.setPassword}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        error={s.password.length > 0 && !s.passwordValid ? translate('auth.signup.password_hint', { min: MIN_PASSWORD }) : undefined}
        testID="signup-password"
      />
      <Button label={translate('auth.signup.submit')} onPress={s.signUpWithEmail} loading={s.busy === 'email'} disabled={!s.canSubmit} testID="signup-submit" />
      {SOCIAL_LOGIN_ENABLED ? <SocialSection {...s} /> : null}
    </View>
  );
}

function SocialSection(s: ReturnType<typeof useSignup>) {
  const providers = useSocialProviders();
  return (
    <View>
      <View className="my-6 flex-row items-center">
        <View className="h-px flex-1 bg-border" />
        <Text className="mx-3 text-xs text-muted-foreground" tx="auth.or" />
        <View className="h-px flex-1 bg-border" />
      </View>
      <AppleSignInButton mode="signup" onPress={() => s.signUpSocial('apple')} disabled={s.busy !== null} loading={s.busy === 'apple'} />
      {providers.map(([id, label]) => (
        <Button key={id} variant="outline" label={translate('auth.continue_with', { provider: label })} onPress={() => s.signUpSocial(id)} loading={s.busy === id} disabled={s.busy !== null} testID={`signup-${id}`} />
      ))}
    </View>
  );
}
