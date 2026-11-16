import { CalendarDays } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { colors, Modal, Text, useModal } from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { formatDateLong } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { dateKey, parseDateKey, periodTitle, shiftPeriod } from '../period';
import { CalendarGrid } from './calendar-grid';
import { PeriodHeader } from './period-header';

type DateFieldProps = {
  label: string;
  /** yyyy-MM-dd */
  value: string;
  onChange: (value: string) => void;
  testID?: string;
};

/** Datovælger: felt der åbner en kalender i et bottom sheet (egen — ingen native picker-afhængighed). */
export function DateField({ label, value, onChange, testID }: DateFieldProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const modal = useModal();
  const selected = React.useMemo(() => parseDateKey(value), [value]);
  const [month, setMonth] = React.useState(selected);
  const snapPoints = React.useMemo(() => [460], []);

  const open = () => {
    setMonth(selected);
    modal.present();
  };
  const pick = (day: Date) => {
    onChange(dateKey(day));
    modal.dismiss();
  };

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm font-medium text-muted-foreground">{label}</Text>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        testID={testID ? `${testID}-trigger` : undefined}
      >
        <CalendarDays size={18} color={dark ? colors.neutral[400] : colors.neutral[500]} />
        <Text className="flex-1 text-base text-foreground">{formatDateLong(selected)}</Text>
      </Pressable>
      <Modal
        ref={modal.ref}
        snapPoints={snapPoints}
        title={translate('entries.form.choose_date')}
        backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
      >
        <BottomSheetView>
          <View className="px-4 pb-6">
            <PeriodHeader
              title={periodTitle('month', month)}
              showToday={false}
              onPrev={() => setMonth(m => shiftPeriod('month', m, -1))}
              onNext={() => setMonth(m => shiftPeriod('month', m, 1))}
              onToday={() => setMonth(new Date())}
            />
            <View className="mt-2">
              <CalendarGrid month={month} selected={selected} onSelectDay={pick} />
            </View>
          </View>
        </BottomSheetView>
      </Modal>
    </View>
  );
}
