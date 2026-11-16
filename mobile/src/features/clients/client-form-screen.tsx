import type { ClientFormErrors, ClientFormValues } from './client-form-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import * as React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Button, ErrorState, Input, ListSkeleton, Screen, Text } from '~/components/ui';
import { errorMessage, trpc, useInvalidateDirectory } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { applyCvr, canLookupCvr, EMPTY_CLIENT, fromClient, normalizeCvr, toClientInput, validateClient } from './client-form-logic';
import { CLIENT_COLOR_CHOICES } from './client-logic';

type Client = RouterOutputs['clients']['getById'];

/** Én skærm til både opret (`/clients/new`) og redigér (`/clients/[id]/edit`). */
export function ClientFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;
  const existing = trpc.clients.getById.useQuery({ id: id ?? '' }, { enabled: isEdit });
  // Pladsholderen er lydløs for en skærmlæser: brugeren hørte titlen og så
  // stilhed indtil felterne kom. Kaldes før de to `return`s, så skærmen siger
  // det samme som den viser. På `/clients/new` er kaldet slået fra, så
  // `isLoading` er false fra starten og der læses intet — intet blev ventet.
  useAnnounceLoaded(existing, translate('common.loaded'));

  if (isEdit && existing.isLoading)
    return <Screen back title={translate('clients.edit_title')}><ListSkeleton rows={3} /></Screen>;
  if (isEdit && (existing.isError || !existing.data))
    return <Screen back title={translate('clients.edit_title')}><ErrorState message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} /></Screen>;

  return <ClientForm key={existing.data?.id ?? 'new'} existing={existing.data} />;
}

function ClientForm({ existing }: { existing: Client | undefined }) {
  const router = useRouter();
  const invalidateDirectory = useInvalidateDirectory();
  const [values, setValues] = React.useState<ClientFormValues>(() => (existing ? fromClient(existing) : EMPTY_CLIENT));
  const [errors, setErrors] = React.useState<ClientFormErrors>({});
  const set = <K extends keyof ClientFormValues>(key: K) => (value: ClientFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const onSuccess = (message: string) => {
    invalidateDirectory();
    showMessage({ message, type: 'success' });
    router.back();
  };
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const create = trpc.clients.create.useMutation({ onSuccess: () => onSuccess(translate('clients.created')), onError });
  const update = trpc.clients.update.useMutation({ onSuccess: () => onSuccess(translate('clients.saved')), onError });
  const saving = create.isPending || update.isPending;

  const submit = () => {
    const next = validateClient(values);
    setErrors(next);
    if (Object.keys(next).length > 0)
      return;
    const data = toClientInput(values);
    if (existing)
      update.mutate({ id: existing.id, data });
    else
      create.mutate(data);
  };

  return (
    <Screen back title={existing ? translate('clients.edit_title') : translate('clients.new_title')} scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Input label={translate('clients.name')} value={values.name} onChangeText={set('name')} error={errors.name} autoFocus={!existing} testID="client-name" />
        <Input label={translate('clients.company')} value={values.company} onChangeText={set('company')} testID="client-company" />
        <Input label={translate('clients.email')} value={values.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} testID="client-email" />
        <Input label={translate('clients.phone')} value={values.phone} onChangeText={set('phone')} keyboardType="phone-pad" testID="client-phone" />
        <CvrField values={values} onChange={patch => setValues(prev => ({ ...prev, ...patch }))} />
        <Input label={translate('clients.address')} value={values.address} onChangeText={set('address')} testID="client-address" />
        <View className="flex-row gap-2">
          <View className="w-1/3"><Input label={translate('clients.postal_code')} value={values.postalCode} onChangeText={set('postalCode')} keyboardType="number-pad" testID="client-postal" /></View>
          <View className="flex-1"><Input label={translate('clients.city')} value={values.city} onChangeText={set('city')} testID="client-city" /></View>
        </View>
        <Input
          label={translate('clients.hourly_rate')}
          value={values.defaultHourlyRate}
          onChangeText={set('defaultHourlyRate')}
          error={errors.defaultHourlyRate}
          placeholder={translate('clients.hourly_rate_hint')}
          keyboardType="decimal-pad"
          testID="client-rate"
        />
        <ColorPicker value={values.color} onChange={set('color')} />
        <Input label={translate('clients.notes')} value={values.notes} onChangeText={set('notes')} multiline numberOfLines={4} style={{ minHeight: 96, textAlignVertical: 'top' }} testID="client-notes" />
        <Button label={existing ? translate('clients.save') : translate('clients.create')} loading={saving} onPress={submit} className="mt-4 rounded-xl bg-primary-600" textClassName="text-white" testID="client-submit" />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function CvrField({ values, onChange }: { values: ClientFormValues; onChange: (patch: Partial<ClientFormValues>) => void }) {
  const lookup = trpc.integrations.cvrLookup.useMutation({
    onSuccess: (company) => {
      if (company === null) {
        showMessage({ message: translate('clients.cvr_lookup_failed'), type: 'danger' });
        return;
      }
      onChange(applyCvr(values, company));
      showMessage({ message: translate('clients.cvr_lookup_ok'), type: 'success' });
    },
    onError: () => showMessage({ message: translate('clients.cvr_lookup_failed'), type: 'danger' }),
  });
  return (
    <View className="flex-row items-end gap-2">
      <View className="flex-1">
        <Input label={translate('clients.cvr')} value={values.cvrNumber} onChangeText={v => onChange({ cvrNumber: v })} keyboardType="number-pad" testID="client-cvr" />
      </View>
      <Button
        variant="outline"
        fullWidth={false}
        label={translate('clients.cvr_lookup')}
        loading={lookup.isPending}
        disabled={!canLookupCvr(values.cvrNumber)}
        onPress={() => lookup.mutate({ cvrNumber: normalizeCvr(values.cvrNumber) })}
        className="mb-2 rounded-xl"
        testID="client-cvr-lookup"
      />
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View className="mb-2">
      <Text className="mb-1 text-lg text-neutral-800 dark:text-neutral-100">{translate('clients.color')}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => onChange(null)}
          accessibilityRole="button"
          accessibilityLabel={translate('clients.no_color')}
          accessibilityState={{ selected: value === null }}
          className="size-11 items-center justify-center rounded-full border border-border bg-muted"
          testID="client-color-none"
        >
          {value === null ? <Check size={16} color="#737373" /> : null}
        </Pressable>
        {CLIENT_COLOR_CHOICES.map(({ hex, tx }) => (
          <Pressable
            key={hex}
            onPress={() => onChange(hex)}
            accessibilityRole="button"
            accessibilityLabel={translate(tx)}
            accessibilityState={{ selected: value === hex }}
            style={{ backgroundColor: hex }}
            className="size-11 items-center justify-center rounded-full"
            testID={`client-color-${hex.slice(1)}`}
          >
            {value === hex ? <Check size={16} color="#fff" /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
