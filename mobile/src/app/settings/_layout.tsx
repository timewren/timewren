import { Stack } from 'expo-router';
import { translate } from '~/lib/i18n';

/** Indstillinger som stack under Mere-fanen. Skærmene tegner selv header via `Screen back`. */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="about" options={{ title: translate('settings.about.title') }} />
      <Stack.Screen name="appearance" options={{ title: translate('settings.appearance.title') }} />
      <Stack.Screen name="calls" options={{ title: translate('calls.settings_title') }} />
      <Stack.Screen name="company" options={{ title: translate('settings.company.title') }} />
      <Stack.Screen name="delete-account" options={{ title: translate('settings.delete_account.title') }} />
      <Stack.Screen name="feedback" options={{ title: translate('settings.feedback.title') }} />
      <Stack.Screen name="notifications" options={{ title: translate('settings.notifications.title') }} />
      <Stack.Screen name="offline" options={{ title: translate('offline.title') }} />
      <Stack.Screen name="organization" options={{ title: translate('settings.organization.title') }} />
      <Stack.Screen name="profile" options={{ title: translate('settings.profile.title') }} />
      <Stack.Screen name="security" options={{ title: translate('settings.security.title') }} />
      <Stack.Screen name="subscription" options={{ title: translate('settings.subscription.title') }} />
    </Stack>
  );
}
