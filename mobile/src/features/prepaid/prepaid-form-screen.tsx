import type { PrepaidFormErrors, PrepaidFormValues } from './prepaid-form-logic';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Button, Input, Screen, Select, Switch, Text } from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { emptyPrepaid, toPrepaidInput, validatePrepaid } from './prepaid-form-logic';
import { addMonthsISO, parseDecimal } from './prepaid-logic';

export function PrepaidFormScreen() {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [values, setValues] = React.useState<PrepaidFormValues>(() => emptyPrepaid(clientId ?? null));
  const [errors, setErrors] = React.useState<PrepaidFormErrors>({});
  const set = <K extends keyof PrepaidFormValues>(key: K) => (value: PrepaidFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const clients = trpc.clients.list.useQuery();
  const clientOptions = React.useMemo(
    () => (clients.data ?? []).filter(c => !c.isArchived).map(c => ({ value: c.id, label: c.name })),
    [clients.data],
  );
  const selectedClient = React.useMemo(() => clients.data?.find(c => c.id === values.clientId), [clients.data, values.clientId]);
  const suggestedRate = selectedClient?.defaultHourlyRate ?? null;

  const create = trpc.prepaid.create.useMutation({
    onSuccess: () => {
      void utils.prepaid.invalidate();
      void utils.clients.invalidate();
      showMessage({ message: translate('prepaid.created'), type: 'success' });
      router.back();
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  const submit = () => {
    const next = validatePrepaid(values);
    setErrors(next);
    if (Object.keys(next).length > 0)
      return;
    create.mutate(toPrepaidInput(values));
  };

  const hours = parseDecimal(values.totalHours);
  const rate = parseDecimal(values.hourlyRate);
  const totalValue = hours !== null && rate !== null ? hours * rate : null;

  return (
    <Screen back title={translate('prepaid.new_title')} scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Select
          label={translate('prepaid.client')}
          value={values.clientId ?? undefined}
          options={clientOptions}
          placeholder={translate('projects.select_client')}
          error={errors.clientId ?? (clients.isError ? translate('common.error_load') : undefined)}
          onSelect={v => set('clientId')(String(v))}
          testID="prepaid-client"
        />
        <Input label={translate('prepaid.name')} value={values.name} onChangeText={set('name')} error={errors.name} placeholder={translate('prepaid.name_placeholder')} testID="prepaid-name" />
        <Input label={translate('prepaid.hours')} value={values.totalHours} onChangeText={set('totalHours')} error={errors.totalHours} keyboardType="decimal-pad" testID="prepaid-hours" />
        <Input
          label={translate('prepaid.hourly_rate')}
          value={values.hourlyRate}
          onChangeText={set('hourlyRate')}
          error={errors.hourlyRate}
          keyboardType="decimal-pad"
          placeholder={suggestedRate ? formatMoney(suggestedRate) : undefined}
          testID="prepaid-rate"
        />
        {suggestedRate && !values.hourlyRate
          ? (
              <Pressable onPress={() => set('hourlyRate')(suggestedRate)} className="-mt-1 mb-2" accessibilityRole="button" testID="prepaid-use-client-rate">
                <Text className="text-xs text-primary-600 dark:text-primary-400">{translate('projects.rate_inherit_client', { rate: formatMoney(suggestedRate) })}</Text>
              </Pressable>
            )
          : null}
        {totalValue !== null
          ? <Text className="mb-2 text-sm text-muted-foreground">{`${translate('prepaid.total_value')}: ${formatMoney(totalValue)} (${formatHours(hours ?? 0)})`}</Text>
          : null}
        <Input label={translate('prepaid.expiry_date')} value={values.expiryDate} onChangeText={set('expiryDate')} error={errors.expiryDate} placeholder={translate('prepaid.expiry_hint')} autoCapitalize="none" testID="prepaid-expiry" />
        <ExpiryShortcuts hasValue={!!values.expiryDate} onPick={set('expiryDate')} />
        <View className="mb-3">
          <Switch checked={values.autoDeduct} onChange={set('autoDeduct')} accessibilityLabel={translate('prepaid.auto_deduct')} label={translate('prepaid.auto_deduct')} testID="prepaid-auto-deduct" />
          <Text className="mt-1 text-xs text-muted-foreground">{translate('prepaid.auto_deduct_hint')}</Text>
        </View>
        <Input label={translate('prepaid.description')} value={values.description} onChangeText={set('description')} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} testID="prepaid-description" />
        <Button label={translate('prepaid.create')} loading={create.isPending} onPress={submit} className="mt-4 rounded-xl bg-primary-600" textClassName="text-white" testID="prepaid-submit" />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ExpiryShortcuts({ hasValue, onPick }: { hasValue: boolean; onPick: (iso: string) => void }) {
  return (
    <View className="mb-3 flex-row gap-2">
      {[3, 6, 12].map(months => (
        <Button
          key={months}
          variant="outline"
          size="sm"
          fullWidth={false}
          label={translate('prepaid.plus_months', { months })}
          onPress={() => onPick(addMonthsISO(months))}
          className="rounded-full"
          testID={`prepaid-expiry-${months}`}
        />
      ))}
      {hasValue
        ? <Button variant="ghost" size="sm" fullWidth={false} label={translate('prepaid.no_expiry')} onPress={() => onPick('')} testID="prepaid-expiry-clear" />
        : null}
    </View>
  );
}
