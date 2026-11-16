import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { OvertimePostType } from './overtime-logic';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button } from '~/components/ui/button';
import colors from '~/components/ui/colors';
import { Input } from '~/components/ui/input';
import { Modal } from '~/components/ui/modal';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { haptic } from '~/features/enterprise/absence/use-approval';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { parseOvertimeHours } from './overtime-logic';

type Member = { userId: string; name: string };

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  members: readonly Member[];
};

/** Manuel postering (leder/admin): afspadsering, udbetaling eller korrektion. */
export function AddEntrySheet({ sheetRef, members }: Props) {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const utils = trpc.useUtils();
  const [userId, setUserId] = React.useState('');
  const [type, setType] = React.useState<OvertimePostType>('used');
  const [hoursText, setHoursText] = React.useState('');
  const [note, setNote] = React.useState('');

  const mutation = trpc.enterprise.addOvertimeEntry.useMutation({
    onSuccess: () => {
      haptic(true);
      void utils.enterprise.getOvertimeOverview.invalidate();
      void utils.enterprise.getMyOvertime.invalidate();
      void utils.enterprise.getBalance.invalidate();
      showMessage({ message: translate('enterprise.overtime.added_toast'), type: 'success' });
      setHoursText('');
      setNote('');
      sheetRef.current?.dismiss();
    },
    onError: (e) => {
      haptic(false);
      showMessage({ message: errorMessage(e), type: 'danger' });
    },
  });

  const hours = parseOvertimeHours(hoursText, type);
  const valid = !!userId && hours !== null && note.trim().length > 0;
  const typeOptions = [
    { value: 'used', label: translate('enterprise.overtime.post_used') },
    { value: 'payout', label: translate('enterprise.overtime.post_payout') },
    { value: 'adjustment', label: translate('enterprise.overtime.post_adjustment') },
  ];

  return (
    <Modal
      ref={sheetRef as React.RefObject<BottomSheetModal>}
      title={translate('enterprise.overtime.add_entry')}
      snapPoints={['80%']}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: isDark ? colors.neutral[900] : colors.white }}
    >
      <View className="px-4">
        <Select
          label={translate('enterprise.overtime.employee')}
          placeholder={translate('enterprise.overtime.employee_placeholder')}
          options={members.map(m => ({ value: m.userId, label: m.name }))}
          value={userId || undefined}
          onSelect={v => setUserId(String(v))}
          testID="overtime-user"
        />
        <Select
          label={translate('enterprise.overtime.post_type')}
          options={typeOptions}
          value={type}
          onSelect={v => setType(v as OvertimePostType)}
          testID="overtime-type"
        />
        <Input
          label={translate('enterprise.overtime.hours')}
          placeholder={type === 'adjustment' ? '−1,5 / 2' : '2,5'}
          keyboardType="numbers-and-punctuation"
          value={hoursText}
          onChangeText={setHoursText}
          error={hoursText && hours === null ? translate('enterprise.overtime.hours_invalid') : undefined}
          testID="overtime-hours"
        />
        <Input
          label={translate('enterprise.overtime.note')}
          placeholder={translate('enterprise.overtime.note_placeholder')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          testID="overtime-note"
        />
        <Text className="mb-2 text-xs text-muted-foreground">{translate('enterprise.overtime.post_hint')}</Text>
        <Button
          label={translate('enterprise.overtime.post')}
          disabled={!valid}
          loading={mutation.isPending}
          onPress={() => hours !== null && mutation.mutate({ userId, type, hours, note: note.trim() })}
          testID="overtime-submit"
        />
      </View>
    </Modal>
  );
}
