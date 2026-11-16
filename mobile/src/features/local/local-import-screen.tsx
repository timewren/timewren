import { useRouter } from 'expo-router';
import { UploadCloud } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, colors, ListRow, Screen, Text } from '~/components/ui';
import { errorMessage } from '~/lib/api';
import { formatHoursClock } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { importCounts } from './local-logic';
import { localStore, useLocalStore } from './local-store';
import { useLocalImport } from './use-local-import';

/** Vises efter login/oprettelse når der ligger "uden konto"-data på telefonen. */
export function LocalImportScreen() {
  const router = useRouter();
  const clients = useLocalStore.use.clients();
  const projects = useLocalStore.use.projects();
  const tags = useLocalStore.use.tags();
  const entries = useLocalStore.use.entries();
  const timer = useLocalStore.use.timer();
  const counts = importCounts({ clients, projects, tags, entries, timer });
  const job = useLocalImport();

  const run = async () => {
    const ok = await job.start();
    if (ok) {
      showMessage({ message: translate('local.import.done'), type: 'success' });
      router.replace('/');
    }
  };

  const later = () => {
    localStore().deferImport();
    router.replace('/');
  };

  const discard = () => {
    Alert.alert(translate('local.clear_title'), translate('local.clear_body'), [
      { text: translate('common.cancel'), style: 'cancel' },
      {
        text: translate('common.delete'),
        style: 'destructive',
        onPress: () => {
          localStore().clearAll();
          router.replace('/');
        },
      },
    ]);
  };

  const rows: Array<[string, string]> = [
    [translate('local.import.entries'), String(counts.entries + (timer ? 1 : 0))],
    [translate('local.import.total'), formatHoursClock(counts.seconds / 3600)],
    [translate('local.import.projects'), String(counts.projects)],
    [translate('local.import.clients'), String(counts.clients)],
    [translate('local.import.tags'), String(counts.tags)],
  ];

  return (
    <Screen noHeader contentContainerClassName="flex-grow justify-center px-6 pb-8">
      <View className="mb-6 items-center">
        <View className="mb-4 size-14 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-900">
          <UploadCloud size={26} color={colors.primary[600]} />
        </View>
        <Text className="text-center text-2xl font-bold text-foreground" tx="local.import.title" />
        <Text className="mt-1 text-center text-muted-foreground" tx="local.import.body" />
      </View>
      <Card className="mb-6 p-0">
        {rows.map(([label, value], i) => <ListRow key={label} title={label} right={value} last={i === rows.length - 1} />)}
      </Card>
      {job.error ? <Text className="mb-3 text-center text-danger-600">{errorMessage(job.error)}</Text> : null}
      {job.running && job.progress
        ? <Text className="mb-3 text-center text-muted-foreground">{translate('local.import.progress', { done: job.progress.done, total: job.progress.total })}</Text>
        : null}
      <Button label={translate('local.import.cta')} onPress={run} loading={job.running} testID="local-import-run" />
      <Button variant="ghost" label={translate('local.import.later')} onPress={later} disabled={job.running} testID="local-import-later" />
      <Button variant="ghost" size="sm" label={translate('local.import.delete')} onPress={discard} disabled={job.running} testID="local-import-delete" />
    </Screen>
  );
}
