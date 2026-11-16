import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, Banknote, Clock, Hourglass, MinusCircle, PlusCircle, Ticket } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import {
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  Input,
  ListRow,
  ListSkeleton,
  Modal,
  Screen,
  SectionHeader,
  StatTile,
  Switch,
  Text,
  useModal,
} from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { clientHref, entryHref } from '~/features/clients/hrefs';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateRelative, formatDateShort, formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { BalanceBar, ExpiryBadge } from './components/prepaid-card';
import { parseDecimal, prepaidStatus } from './prepaid-logic';

type Pkg = RouterOutputs['prepaid']['getById'];
type Usage = Pkg['usageHistory'][number];

function useInvalidatePrepaid() {
  const utils = trpc.useUtils();
  return React.useCallback(() => {
    void utils.prepaid.invalidate();
    void utils.clients.invalidate();
    void utils.time.invalidate();
  }, [utils]);
}

export function PrepaidDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pkg = trpc.prepaid.getById.useQuery({ id }, { enabled: !!id });
  useAnnounceLoaded(pkg, translate('common.loaded'));

  if (pkg.isLoading)
    return <Screen back title=""><ListSkeleton rows={4} /></Screen>;
  if (pkg.isError || !pkg.data)
    return <Screen back title=""><ErrorState message={errorMessage(pkg.error)} onRetry={() => void pkg.refetch()} /></Screen>;

  const data = pkg.data;
  const s = prepaidStatus(data);
  const hideValue = data.hideValue;
  return (
    <Screen back title={data.name} subtitle={data.client?.name} refreshing={pkg.isRefetching} onRefresh={() => void pkg.refetch()}>
      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">{translate('prepaid.purchase_date', { date: formatDateShort(data.purchaseDate) })}</Text>
          <ExpiryBadge pkg={data} />
        </View>
        <View className="mt-3">
          <BalanceBar
            fraction={s.fraction}
            tone={s.balanceTone === 'danger' ? 'danger' : s.balanceTone === 'warning' ? 'warning' : 'violet'}
            a11yLabel={translate('prepaid.remaining', { remaining: formatHours(s.remainingHours), total: formatHours(s.totalHours) })}
          />
        </View>
        {data.description ? <Text className="mt-3 text-sm text-foreground">{data.description}</Text> : null}
      </Card>

      <View className="mt-3 gap-2">
        <View className="flex-row gap-2">
          <StatTile label={translate('prepaid.stat_remaining')} value={formatHours(s.remainingHours)} icon={Hourglass} tone={s.balanceTone} />
          <StatTile label={translate('prepaid.stat_used')} value={formatHours(s.usedHours)} icon={Clock} />
        </View>
        <View className="flex-row gap-2">
          <StatTile label={translate('prepaid.stat_total')} value={formatHours(s.totalHours)} icon={Ticket} />
          {hideValue
            ? <StatTile label={translate('prepaid.hourly_rate')} value="—" icon={Banknote} />
            : <StatTile label={translate('prepaid.stat_value')} value={formatMoney(s.remainingHours * Number.parseFloat(data.hourlyRate))} hint={`${formatMoney(data.hourlyRate)}/t`} icon={Banknote} tone="violet" />}
        </View>
      </View>

      <AutoDeductToggle pkg={data} />

      <SectionHeader title={translate('prepaid.history')} />
      <UsageHistory usage={data.usageHistory} hideValue={hideValue} onOpenEntry={eid => router.push(entryHref(eid))} />

      <SectionHeader title={translate('prepaid.actions_title')} />
      <Actions pkg={data} />
      {data.client
        ? <Button variant="outline" label={data.client.name} onPress={() => router.push(clientHref(data.clientId))} className="rounded-xl" testID="prepaid-open-client" />
        : null}
    </Screen>
  );
}

function AutoDeductToggle({ pkg }: { pkg: Pkg }) {
  const invalidate = useInvalidatePrepaid();
  const mutation = trpc.prepaid.setAutoDeduct.useMutation({
    onSuccess: invalidate,
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
  return (
    <Card className="mt-3">
      <Switch
        checked={pkg.autoDeduct}
        disabled={mutation.isPending}
        onChange={checked => mutation.mutate({ packageId: pkg.id, autoDeduct: checked })}
        accessibilityLabel={translate('prepaid.auto_deduct')}
        label={translate('prepaid.auto_deduct')}
        testID="prepaid-auto-deduct"
      />
      <Text className="mt-1 text-xs text-muted-foreground">{translate('prepaid.auto_deduct_hint')}</Text>
    </Card>
  );
}

function UsageHistory({ usage, hideValue, onOpenEntry }: { usage: Usage[]; hideValue: boolean; onOpenEntry: (id: string) => void }) {
  if (usage.length === 0)
    return <Card><EmptyState title={translate('prepaid.no_history')} compact /></Card>;
  return (
    <Card className="p-0">
      {usage.map((u, index) => {
        const entry = u.timeEntry;
        const title = entry?.description?.trim() || entry?.project?.name || u.description || translate('prepaid.manual_entry');
        const date = formatDateRelative(entry?.date ?? u.createdAt);
        const hours = Number.parseFloat(u.hoursUsed);
        const value = hideValue ? '' : ` · ${formatMoney(u.valueUsed)}`;
        return (
          <ListRow
            key={u.id}
            title={title}
            subtitle={`${date}${value}`}
            right={<Text className="font-medium text-danger-600 dark:text-danger-400">{`−${formatHours(hours)}`}</Text>}
            onPress={entry ? () => onOpenEntry(entry.id) : undefined}
            chevron={!!entry}
            last={index === usage.length - 1}
            testID={`usage-row-${u.id}`}
          />
        );
      })}
    </Card>
  );
}

function Actions({ pkg }: { pkg: Pkg }) {
  const router = useRouter();
  const invalidate = useInvalidatePrepaid();
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const topUpModal = useModal();
  const deductModal = useModal();
  const topUp = trpc.prepaid.topUp.useMutation({
    onSuccess: () => {
      invalidate();
      topUpModal.dismiss();
      showMessage({ message: translate('prepaid.topped_up'), type: 'success' });
    },
    onError,
  });
  const deduct = trpc.prepaid.manualDeduct.useMutation({
    onSuccess: () => {
      invalidate();
      deductModal.dismiss();
      showMessage({ message: translate('prepaid.deducted'), type: 'success' });
    },
    onError,
  });
  const archive = trpc.prepaid.archive.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('prepaid.archived_toast'), type: 'success' });
      router.back();
    },
    onError,
  });

  const confirmArchive = () => Alert.alert(
    translate('prepaid.archive_confirm_title', { name: pkg.name }),
    translate('prepaid.archive_confirm_body'),
    [
      { text: translate('prepaid.cancel'), style: 'cancel' },
      { text: translate('prepaid.archive'), style: 'destructive', onPress: () => archive.mutate({ id: pkg.id }) },
    ],
  );
  const confirmTopUp = (hours: number, note: string) => Alert.alert(
    translate('prepaid.top_up'),
    translate('prepaid.top_up_confirm', { hours: formatHours(hours), name: pkg.name }),
    [
      { text: translate('prepaid.cancel'), style: 'cancel' },
      { text: translate('prepaid.confirm'), onPress: () => topUp.mutate({ packageId: pkg.id, hours, note: note.trim() || undefined }) },
    ],
  );
  const confirmDeduct = (hours: number, description: string) => Alert.alert(
    translate('prepaid.deduct'),
    translate('prepaid.deduct_confirm', { hours: formatHours(hours), name: pkg.name }),
    [
      { text: translate('prepaid.cancel'), style: 'cancel' },
      { text: translate('prepaid.confirm'), style: 'destructive', onPress: () => deduct.mutate({ packageId: pkg.id, hours, description: description.trim() }) },
    ],
  );

  return (
    <View className="gap-1">
      {!pkg.isArchived
        ? (
            <>
              <ActionButton icon={<PlusCircle size={18} color={colors.violet[600]} />} label={translate('prepaid.top_up')} onPress={topUpModal.present} testID="prepaid-top-up" />
              <ActionButton icon={<MinusCircle size={18} color={colors.warning[600]} />} label={translate('prepaid.deduct')} onPress={deductModal.present} testID="prepaid-deduct" />
              <ActionButton icon={<Archive size={18} color={colors.danger[600]} />} label={translate('prepaid.archive')} onPress={confirmArchive} loading={archive.isPending} danger testID="prepaid-archive" />
            </>
          )
        : null}
      <HoursSheet ref={topUpModal.ref} title={translate('prepaid.top_up')} noteLabel={translate('prepaid.top_up_note')} requireNote={false} loading={topUp.isPending} onSubmit={confirmTopUp} testID="top-up" />
      <HoursSheet ref={deductModal.ref} title={translate('prepaid.deduct')} noteLabel={translate('prepaid.deduct_description')} requireNote loading={deduct.isPending} onSubmit={confirmDeduct} testID="deduct" />
    </View>
  );
}

type ActionButtonProps = { icon: React.ReactNode; label: string; onPress: () => void; loading?: boolean; danger?: boolean; testID: string };

function ActionButton({ icon, label, onPress, loading, danger, testID }: ActionButtonProps) {
  return (
    <Button variant="outline" onPress={onPress} loading={loading} className="rounded-xl" testID={testID}>
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className={danger ? 'font-semibold text-danger-600' : 'font-semibold text-foreground'}>{label}</Text>
      </View>
    </Button>
  );
}

type HoursSheetProps = {
  ref: React.RefObject<React.ComponentRef<typeof Modal> | null>;
  title: string;
  noteLabel: string;
  requireNote: boolean;
  loading: boolean;
  onSubmit: (hours: number, note: string) => void;
  testID: string;
};

/** Bundark med timer + note — bruges til både opfyldning og manuelt træk. */
function HoursSheet({ ref, title, noteLabel, requireNote, loading, onSubmit, testID }: HoursSheetProps) {
  const [hours, setHours] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [noteError, setNoteError] = React.useState<string | undefined>();
  const submit = () => {
    const n = parseDecimal(hours);
    const hoursErr = n === null || n <= 0 ? translate('prepaid.error_hours') : undefined;
    const noteErr = requireNote && !note.trim() ? translate('prepaid.error_description') : undefined;
    setError(hoursErr);
    setNoteError(noteErr);
    if (hoursErr || noteErr || n === null)
      return;
    onSubmit(n, note);
  };
  return (
    <Modal ref={ref} title={title} snapPoints={['55%']} keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize">
      <BottomSheetView className="px-4 pb-8">
        <Input label={translate('prepaid.hours')} value={hours} onChangeText={setHours} error={error} keyboardType="decimal-pad" placeholder="fx 5" testID={`${testID}-hours`} />
        <Input label={noteLabel} value={note} onChangeText={setNote} error={noteError} testID={`${testID}-note`} />
        <Button label={title} loading={loading} onPress={submit} className="mt-2 rounded-xl bg-primary-600" textClassName="text-white" testID={`${testID}-submit`} />
      </BottomSheetView>
    </Modal>
  );
}
