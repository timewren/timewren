import * as AppleAuthentication from 'expo-apple-authentication';
import * as React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { isAppleSignInAvailable } from '~/lib/auth/apple';

type Props = { onPress: () => void; disabled?: boolean; loading?: boolean; mode?: 'signin' | 'signup' };

/**
 * Apples egen "Sign in with Apple"-knap (krav i HIG: Apples knap, ikke en tegnet kopi).
 * Rendres kun på iOS hvor funktionen findes; Android får ingen Apple-knap.
 * Apples knap kan ikke vise en spinner selv, så `loading` lægger en ovenpå, mens serveren
 * veksler Apple-tokenet til en session (ellers ser knappen død ud efter Apple-arket).
 */
export function AppleSignInButton({ onPress, disabled, loading, mode = 'signin' }: Props) {
  const { theme } = useUniwind();
  const [available, setAvailable] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void isAppleSignInAvailable().then(v => alive && setAvailable(v));
    return () => {
      alive = false;
    };
  }, []);
  if (Platform.OS !== 'ios' || !available)
    return null;
  return (
    <View className="mb-3" pointerEvents={disabled ? 'none' : 'auto'} style={disabled ? { opacity: 0.5 } : undefined} testID="login-apple">
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={mode === 'signup'
          ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={theme === 'dark'
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={{ width: '100%', height: 44 }}
        onPress={onPress}
      />
      {loading
        ? (
            <View
              className="absolute inset-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: theme === 'dark' ? '#fff' : '#000' }}
              testID="login-apple-loading"
            >
              <ActivityIndicator color={theme === 'dark' ? '#000' : '#fff'} />
            </View>
          )
        : null}
    </View>
  );
}
