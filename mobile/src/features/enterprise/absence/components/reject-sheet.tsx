import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button } from '~/components/ui/button';
import colors from '~/components/ui/colors';
import { Input } from '~/components/ui/input';
import { Modal } from '~/components/ui/modal';
import { Text } from '~/components/ui/text';
import { translate } from '~/lib/i18n';

type RejectSheetProps = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  /** Antal anmodninger der afvises (1 = enkelt) */
  count: number;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onDismiss?: () => void;
};

/** Begrundelses-sheet ved afvisning (enkelt eller batch). */
export function RejectSheet({ sheetRef, count, loading, onConfirm, onDismiss }: RejectSheetProps) {
  const [reason, setReason] = React.useState('');
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  return (
    <Modal
      ref={sheetRef as React.RefObject<BottomSheetModal>}
      title={translate('enterprise.absence.reject_title')}
      snapPoints={['45%']}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: isDark ? colors.neutral[900] : colors.white }}
    >
      <View className="px-4">
        <Text className="mb-3 text-sm text-muted-foreground">
          {count > 1
            ? translate('enterprise.absence.reject_body_many', { count })
            : translate('enterprise.absence.reject_body')}
        </Text>
        <Input
          label={translate('enterprise.absence.reject_reason')}
          placeholder={translate('enterprise.absence.reject_reason_placeholder')}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={500}
          testID="reject-reason"
        />
        <Button
          variant="destructive"
          label={translate('enterprise.absence.reject')}
          loading={loading}
          onPress={() => onConfirm(reason.trim())}
          className="rounded-xl"
          testID="reject-confirm"
        />
      </View>
    </Modal>
  );
}
