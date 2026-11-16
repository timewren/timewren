import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Check, ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import { colors, Modal, Text, useModal } from '~/components/ui';
import { BottomSheetTextInput } from '~/components/ui/bottom-sheet';
import { translate } from '~/lib/i18n';

export type PickerOption = { value: string; label: string; sublabel?: string };

type PickerFieldProps = {
  label: string;
  value: string | null;
  options: PickerOption[];
  onChange: (value: string | null) => void;
  placeholder: string;
  /** Tilføj en "Ingen"-række øverst der nulstiller valget */
  noneLabel?: string;
  disabled?: boolean;
  /** Hjælpetekst under feltet, fx "Vælg først en kunde" */
  hint?: string;
  /**
   * Kallet bag listen fejlede. Feltet låser da op, så brugeren ikke kan åbne et
   * ark med "Ingen resultater" og tro at listen bare er tom.
   */
  error?: string;
  testID?: string;
};

const NONE = '__none__';

function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q)
    return options;
  return options.filter(o => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
}

type OptionRowProps = { item: PickerOption; selected: boolean; onPress: () => void; testID?: string };

function OptionRow({ item, selected, onPress, testID }: OptionRowProps) {
  const { theme } = useUniwind();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-muted"
      testID={testID}
    >
      <View className="flex-1">
        <Text className={twMerge('text-base text-foreground', item.value === NONE ? 'text-muted-foreground' : '')}>{item.label}</Text>
        {item.sublabel ? <Text className="text-sm text-muted-foreground">{item.sublabel}</Text> : null}
      </View>
      {selected ? <Check size={18} color={colors.primary[theme === 'dark' ? 400 : 600]} /> : null}
    </Pressable>
  );
}

/** Søgbar vælger (kunde/projekt/opgave/klippekort) i et bottom sheet. */
export function PickerField(props: PickerFieldProps) {
  const { label, value, options, onChange, placeholder, noneLabel, disabled, hint, error, testID } = props;
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const modal = useModal();
  const [query, setQuery] = React.useState('');
  const snapPoints = React.useMemo(() => ['75%'], []);

  const data = React.useMemo(() => {
    const filtered = filterOptions(options, query);
    return noneLabel && !query ? [{ value: NONE, label: noneLabel }, ...filtered] : filtered;
  }, [options, query, noneLabel]);

  const selectedLabel = options.find(o => o.value === value)?.label ?? null;

  const select = (item: PickerOption) => {
    onChange(item.value === NONE ? null : item.value);
    setQuery('');
    modal.dismiss();
  };

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm font-medium text-muted-foreground">{label}</Text>
      <Pressable
        onPress={modal.present}
        disabled={disabled || Boolean(error)}
        accessibilityRole="button"
        accessibilityHint={error ?? hint}
        className={twMerge(
          'min-h-12 flex-row items-center rounded-xl border border-border bg-card px-4 py-3',
          disabled || error ? 'opacity-50' : '',
        )}
        testID={testID ? `${testID}-trigger` : undefined}
      >
        <Text className={twMerge('flex-1 text-base', selectedLabel ? 'text-foreground' : 'text-muted-foreground')} numberOfLines={1}>
          {selectedLabel ?? placeholder}
        </Text>
        <ChevronDown size={18} color={dark ? colors.neutral[400] : colors.neutral[500]} />
      </Pressable>
      {error
        ? <Text testID={testID ? `${testID}-error` : undefined} className="mt-1 text-sm text-danger-600 dark:text-danger-500">{error}</Text>
        : null}
      {hint && !error ? <Text className="mt-1 text-xs text-muted-foreground">{hint}</Text> : null}
      <Modal
        ref={modal.ref}
        snapPoints={snapPoints}
        title={label}
        keyboardBehavior="extend"
        android_keyboardInputMode="adjustResize"
        backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
      >
        <View className="px-4 pb-2">
          <BottomSheetTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={translate('entries.form.search')}
            placeholderTextColor={colors.neutral[400]}
            autoCorrect={false}
            className="rounded-xl border border-border bg-muted px-4 py-3 text-base text-foreground"
            testID={testID ? `${testID}-search` : undefined}
          />
        </View>
        <BottomSheetFlatList
          accessibilityRole="list"
          data={data}
          keyExtractor={(item: PickerOption) => item.value}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: { item: PickerOption }) => (
            <OptionRow
              item={item}
              selected={item.value === NONE ? value === null : item.value === value}
              onPress={() => select(item)}
              testID={testID ? `${testID}-option-${item.value}` : undefined}
            />
          )}
          ListEmptyComponent={(
            <Text className="px-4 py-6 text-center text-muted-foreground">{translate('entries.form.no_results')}</Text>
          )}
        />
      </Modal>
    </View>
  );
}
