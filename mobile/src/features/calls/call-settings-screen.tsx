import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Platform, View } from 'react-native';
import { Button, Card, Screen, SectionHeader, Switch, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { CALL_LINK_PATH, DEFAULT_CALL_MINUTES } from './call-link';
import { isCallLoggingEnabled, setCallLoggingEnabled } from './call-settings';

/** Hvordan man åbner "Log opkald" udefra — iOS-genvej eller Android-automatisering. */
function SetupHelp() {
  const steps = Platform.OS === 'ios' ? 'calls.setup_ios' : 'calls.setup_android';
  // Byggets eget scheme (preview-builds har et andet end production).
  const link = Linking.createURL(CALL_LINK_PATH, { queryParams: { minutter: String(DEFAULT_CALL_MINUTES) } });
  return (
    <View>
      <SectionHeader title={translate('calls.setup_title')} />
      <Card className="gap-2">
        <Text className="text-sm text-foreground">{translate(steps)}</Text>
        <Text className="text-xs text-muted-foreground" selectable testID="calls-link">{link}</Text>
      </Card>
    </View>
  );
}

/**
 * Indstillinger → Opkald. Slået fra som standard; teksten forklarer præcis hvad
 * appen gør (og ikke gør) før brugeren slår den til. Der bedes ikke om nogen
 * telefonrettigheder — detektion af opkald er et senere, separat skridt.
 */
export function CallSettingsScreen() {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(isCallLoggingEnabled);

  const toggle = (next: boolean) => {
    setCallLoggingEnabled(next);
    setEnabled(next);
  };

  return (
    <Screen title={translate('calls.settings_title')} back>
      <Card className="gap-3">
        <Switch
          checked={enabled}
          onChange={toggle}
          label={translate('calls.enable')}
          accessibilityLabel={translate('calls.enable')}
          testID="calls-toggle"
        />
        <Text className="text-sm text-muted-foreground">{translate('calls.explain')}</Text>
        <Text className="text-sm text-muted-foreground">{translate('calls.permissions')}</Text>
      </Card>
      {enabled
        ? (
            <View>
              <SetupHelp />
              <Button className="mt-4" label={translate('calls.log_now')} onPress={() => router.push('/log-opkald')} testID="calls-log-now" />
            </View>
          )
        : null}
    </Screen>
  );
}
