import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import { Button, colors, Modal, Text } from '~/components/ui';
import { BottomSheetTextInput, BottomSheetView } from '~/components/ui/bottom-sheet';
import { formatDateLong, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';
import { parseHoursInput } from '../week';

export type CellTarget = {
  projectId: string;
  projectName: string;
  activityTypeId: string | null;
  activityName: string | null;
  date: string;
  hours: number;
  /** Detaljerede registreringer (timer/kalender) som cellen ikke kan gå under */
  minHours: number;
  note: string | null;
};

type CellSheetProps = {
  ref: React.RefObject<BottomSheetModal | null>;
  target: CellTarget | null;
  onSave: (target: CellTarget, hours: number, note: string) => void;
  onDismiss: () => void;
};

const QUICK = [0.5, 1, 2, 4, 7.4] as const;
const INPUT_CLS = 'rounded-xl border border-border bg-muted px-4 py-3 text-base text-foreground';

function toText(hours: number): string {
  return hours > 0 ? hours.toLocaleString(intlLocale(), { maximumFractionDigits: 2 }) : '';
}

/** Tal-sheet for én celle: hurtigknapper, input med decimalkomma, note. */
export function CellSheet({ ref, target, onSave, onDismiss }: CellSheetProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const [hoursText, setHoursText] = React.useState('');
  const [note, setNote] = React.useState('');
  const [targetKey, setTargetKey] = React.useState<string | null>(null);

  // Nulstil felterne når en ny celle åbnes (afledt state under render, ikke i effect)
  const key = target ? `${target.projectId}|${target.activityTypeId ?? ''}|${target.date}` : null;
  if (key !== targetKey) {
    setTargetKey(key);
    setHoursText(target ? toText(target.hours) : '');
    setNote(target?.note ?? '');
  }

  const parsed = parseHoursInput(hoursText);
  const valid = hoursText.trim() === '' || parsed !== null;
  const belowMin = target ? (parsed ?? 0) < target.minHours - 0.001 : false;

  const save = () => {
    if (!target || !valid || belowMin)
      return;
    onSave(target, parsed ?? 0, note.trim());
    ref.current?.dismiss();
  };

  return (
    <Modal
      ref={ref}
      snapPoints={['62%']}
      title={target?.projectName}
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView className="px-4 pb-6">
        {target
          ? (
              <>
                <Text className="text-center text-sm text-muted-foreground">
                  {[target.activityName, formatDateLong(target.date)].filter(Boolean).join(' · ')}
                </Text>
                <View className="mt-4 flex-row gap-2">
                  {QUICK.map(q => (
                    <Pressable
                      key={q}
                      onPress={() => setHoursText(toText(q))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: parsed === q }}
                      accessibilityLabel={formatHours(q)}
                      className={twMerge('flex-1 items-center rounded-xl border border-border py-2.5', parsed === q ? 'border-primary-600 bg-primary-600' : 'bg-card')}
                      testID={`cell-quick-${q}`}
                    >
                      <Text className={twMerge('text-sm font-semibold', parsed === q ? 'text-white' : 'text-foreground')}>
                        {formatHours(q, { unit: false })}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text className="mt-4 mb-1 text-sm text-muted-foreground" tx="enterprise.timesheet.hours" />
                <BottomSheetTextInput
                  value={hoursText}
                  onChangeText={setHoursText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.neutral[400]}
                  selectTextOnFocus
                  className={twMerge(INPUT_CLS, 'text-2xl font-semibold', !valid || belowMin ? 'border-danger-600' : '')}
                  testID="cell-hours"
                />
                {belowMin
                  ? (
                      <Text className="mt-1 text-xs text-danger-600">
                        {`Mindst ${formatHours(target.minHours)} er registreret via timer/kalender`}
                      </Text>
                    )
                  : null}
                <BottomSheetTextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={translate('enterprise.timesheet.cell_note_placeholder')}
                  placeholderTextColor={colors.neutral[400]}
                  maxLength={500}
                  className={twMerge(INPUT_CLS, 'mt-3')}
                  testID="cell-note"
                />
                <Button
                  className="mt-4"
                  variant="secondary"
                  label={translate('enterprise.common.save')}
                  onPress={save}
                  disabled={!valid || belowMin}
                  testID="cell-save"
                />
              </>
            )
          : null}
      </BottomSheetView>
    </Modal>
  );
}
