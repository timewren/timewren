import { Stack } from 'expo-router';
import { translate } from '~/lib/i18n';

/** "Uden konto"-tilstand: egen lille stak uden faner. */
export default function LocalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="entry" options={{ title: translate('navigation.entry') }} />
      <Stack.Screen name="import" options={{ title: translate('local.import.title') }} />
      <Stack.Screen name="index" options={{ title: translate('navigation.app') }} />
      <Stack.Screen name="manage" options={{ title: translate('local.manage') }} />
      <Stack.Screen name="stats" options={{ title: translate('local.stats.title') }} />
    </Stack>
  );
}
