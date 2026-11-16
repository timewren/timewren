import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Input, Text } from '~/components/ui';
import { antalDaLogUdsletter, uafsluttetTidNu } from '~/features/auth/logout-guard';
import { signOut } from '~/features/auth/use-auth-store';
import { offlineQueue } from '~/features/offline/queue-store';
import { queryClient } from '~/lib/api/provider';
import { translate } from '~/lib/i18n';
import { changeServer } from './change-server';
import { authStoragePrefix, getApiUrl, isTimeWren, SERVER_KEY, timewrenBrand } from './server-config';
import { checkServer, normalizeServerUrl } from './server-logic';

export function ServerSelector() {
  return isTimeWren ? <Selector /> : null;
}

function Selector() {
  const [custom, setCustom] = React.useState(() => getApiUrl() !== timewrenBrand?.cloudUrl);
  const [url, setUrl] = React.useState(getApiUrl);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [restart, setRestart] = React.useState(false);
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      await changeServer({
        current: getApiUrl(),
        next: normalizeServerUrl(custom ? url : timewrenBrand!.cloudUrl),
        blocked: () => antalDaLogUdsletter(uafsluttetTidNu()) > 0 || offlineQueue().isSyncing || queryClient.isMutating() > 0,
        probe: checkServer,
        signOut: async () => {
          await queryClient.cancelQueries();
          await signOut();
          await SecureStore.deleteItemAsync(`${authStoragePrefix()}_cookie`);
          await SecureStore.deleteItemAsync(`${authStoragePrefix()}_session_data`);
        },
        save: async (next) => {
          await SecureStore.setItemAsync(SERVER_KEY, next);
          setRestart(true);
        },
        restart: () => reloadAppAsync(),
      });
    }
    catch (e) {
      const code = e instanceof Error ? e.message : '';
      const messages = {
        url: 'server.error_url',
        pending: 'server.error_pending',
        storage: 'server.error_storage',
        restart: 'server.error_restart',
      } as const;
      setError(translate(messages[code as keyof typeof messages] ?? 'server.error_health'));
    }
    finally {
      setBusy(false);
    }
  };
  return (
    <View className="mb-6 gap-2 rounded-xl border border-border p-4">
      <Text className="font-semibold" tx="server.title" />
      <Text className="text-sm text-muted-foreground">{getApiUrl()}</Text>
      <Text className="text-sm text-muted-foreground" tx="server.switch_hint" />
      {restart
        ? <Button label={translate('server.restart')} onPress={() => void reloadAppAsync()} />
        : (
            <View>
              <Button variant={custom ? 'outline' : 'default'} label="TimeWren Cloud" onPress={() => setCustom(false)} disabled={busy} />
              <Button variant={custom ? 'default' : 'outline'} label={translate('server.self_hosted')} onPress={() => setCustom(true)} disabled={busy} />
              {custom ? <Input label={translate('server.url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} /> : null}
              <Button label={translate('server.apply')} onPress={() => void apply()} loading={busy} disabled={busy} />
            </View>
          )}
      {error ? <Text accessibilityRole="alert" className="text-danger-600">{error}</Text> : null}
    </View>
  );
}
