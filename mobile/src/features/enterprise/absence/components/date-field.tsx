import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import colors from '~/components/ui/colors';
import { Modal, useModal } from '~/components/ui/modal';
import { Text } from '~/components/ui/text';
import { formatDateShort, toISODate } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { dateFnsLocale } from '~/lib/locale';
import { WEEKDAY_HEADERS } from '../absence-logic';

type MonthCalendarProps = {
  value: string | null;
  onSelect: (iso: string) => void;
  minDate?: string;
  /** Datoer der markeres som helligdage (prik) */
  marked?: ReadonlySet<string>;
};

/** Enkel månedskalender (mandag først). Ingen ekstern afhængighed. */
export function MonthCalendar({ value, onSelect, minDate, marked }: MonthCalendarProps) {
  const [anchor, setAnchor] = React.useState(() => (value ? parseISO(value) : new Date()));
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.neutral[100] : colors.neutral[900];
  const today = useToday();

  const weeks = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    const rows: Date[][] = [];
    for (let d = start; d <= end; d = addDays(d, 7))
      rows.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    return rows;
  }, [anchor]);

  const title = format(anchor, 'MMMM yyyy', { locale: dateFnsLocale() });

  return (
    <View className="px-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable onPress={() => setAnchor(a => addMonths(a, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.previous_month')} className="size-11 items-center justify-center rounded-full active:bg-muted">
          <ChevronLeft size={22} color={tint} />
        </Pressable>
        <Text className="text-base font-semibold text-foreground">{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
        <Pressable onPress={() => setAnchor(a => addMonths(a, 1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.next_month')} className="size-11 items-center justify-center rounded-full active:bg-muted">
          <ChevronRight size={22} color={tint} />
        </Pressable>
      </View>
      <View className="flex-row">
        {WEEKDAY_HEADERS.map(w => (
          <Text key={w.key} className="flex-1 text-center text-xs font-medium text-muted-foreground">{w.label}</Text>
        ))}
      </View>
      {weeks.map(row => (
        <View key={toISODate(row[0]!)} className="flex-row">
          {row.map((day) => {
            const iso = toISODate(day);
            const inMonth = isSameMonth(day, anchor);
            const selected = iso === value;
            const disabled = !!minDate && iso < minDate;
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <Pressable
                key={iso}
                disabled={disabled}
                onPress={() => onSelect(iso)}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                // `min-h-11`, ikke `h-11`: datoen skalerer med systemets skrift,
                // så cellen skal kunne vokse. Porten i `text-scale.test.ts`
                // dømmer `h-11` over en tekst. De 44 px er derfor, fordi en
                // dato-celle skal kunne rammes med en tommelfinger; porten i
                // `touch-target.test.ts` dømmer det mindre.
                className={twMerge(
                  'm-0.5 min-h-11 flex-1 items-center justify-center rounded-lg',
                  selected ? 'bg-primary-600' : iso === today ? 'bg-muted' : '',
                )}
                testID={`day-${iso}`}
              >
                <Text className={twMerge(
                  'text-sm',
                  selected ? 'font-semibold text-white' : weekend ? 'text-muted-foreground' : 'text-foreground',
                  !inMonth || disabled ? 'opacity-30' : '',
                )}
                >
                  {day.getDate()}
                </Text>
                {marked?.has(iso) && !selected
                  ? <View className="absolute bottom-1 size-1 rounded-full bg-danger-500" />
                  : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

type DateFieldProps = {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  minDate?: string;
  marked?: ReadonlySet<string>;
  placeholder?: string;
  disabled?: boolean;
  testID?: string;
};

/** Trykbart datofelt der åbner MonthCalendar i en bottom sheet. */
export function DateField({ label, value, onChange, minDate, marked, placeholder = 'Vælg dato', disabled, testID }: DateFieldProps) {
  const modal = useModal();
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const select = React.useCallback((iso: string) => {
    onChange(iso);
    modal.dismiss();
  }, [onChange, modal]);
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm font-medium text-muted-foreground">{label}</Text>
      <Pressable
        onPress={modal.present}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        className={twMerge('flex-row items-center justify-between rounded-xl border border-border bg-card px-4 py-3', disabled ? 'opacity-50' : 'active:bg-muted')}
        testID={testID}
      >
        <Text className={value ? 'text-base text-foreground' : 'text-base text-muted-foreground'}>
          {value ? formatDateShort(parseISO(value)) : placeholder}
        </Text>
        <CalendarDays size={18} color={isDark ? colors.neutral[400] : colors.neutral[500]} />
      </Pressable>
      <Modal
        ref={modal.ref as React.RefObject<BottomSheetModal>}
        title={label}
        snapPoints={['62%']}
        backgroundStyle={{ backgroundColor: isDark ? colors.neutral[900] : colors.white }}
      >
        <MonthCalendar value={value} onSelect={select} minDate={minDate} marked={marked} />
      </Modal>
    </View>
  );
}
