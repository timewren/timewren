import type { useLogin } from '../use-login';
import * as React from 'react';
import { Button, Input, Text, View } from '~/components/ui';
import { translate } from '~/lib/i18n';

type Props = { login: ReturnType<typeof useLogin> };

const BODY = {
  totp: 'auth.two_factor.body_totp',
  otp: 'auth.two_factor.body_otp',
  backup: 'auth.two_factor.body_backup',
} as const;

/** Kode-trinnet for konti med tofaktor: appens kode, mailkode eller backupkode. */
export function TwoFactorForm({ login }: Props) {
  const { twoFactor, code, setCode, verify, switchMode, cancel } = login.twoFactor;
  if (!twoFactor)
    return null;
  const { mode, methods } = twoFactor;
  const busy = login.busy !== null;
  const canVerify = code.trim().length > 0 && !busy;
  return (
    <View className="rounded-2xl bg-card p-5" testID="login-two-factor">
      <Text className="text-lg font-semibold text-foreground" accessibilityRole="header" tx="auth.two_factor.title" />
      <Text className="mt-1 mb-3 text-muted-foreground" tx={BODY[mode]} />
      <Input
        label={translate('auth.two_factor.code')}
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={mode === 'backup' ? 'default' : 'number-pad'}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        onSubmitEditing={canVerify ? verify : undefined}
        testID="login-two-factor-code"
      />
      <Button label={translate('auth.two_factor.verify')} onPress={verify} disabled={!canVerify} loading={login.busy === 'two_factor'} testID="login-two-factor-verify" />
      {methods.includes('otp')
        ? <Button variant="ghost" size="sm" label={translate(mode === 'otp' ? 'auth.two_factor.resend_email' : 'auth.two_factor.use_email')} onPress={() => switchMode('otp')} disabled={busy} testID="login-two-factor-email" />
        : null}
      {mode !== 'totp' && methods.includes('totp')
        ? <Button variant="ghost" size="sm" label={translate('auth.two_factor.use_totp')} onPress={() => switchMode('totp')} disabled={busy} testID="login-two-factor-totp" />
        : null}
      {mode !== 'backup'
        ? <Button variant="ghost" size="sm" label={translate('auth.two_factor.use_backup')} onPress={() => switchMode('backup')} disabled={busy} testID="login-two-factor-backup" />
        : null}
      <Button variant="ghost" size="sm" label={translate('auth.two_factor.cancel')} onPress={cancel} disabled={busy} testID="login-two-factor-cancel" />
    </View>
  );
}
