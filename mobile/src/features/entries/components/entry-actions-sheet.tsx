import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { LucideIcon } from 'lucide-react-native';
import type { TimeEntry } from '../use-entries';
import { BadgeDollarSign, Copy, Pencil, Receipt, ReceiptText, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import { colors, Modal, Text } from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { translate } from '~/lib/i18n';
import { entryTitle } from '../labels';

type EntryActionsSheetProps = {
  ref: React.RefObject<BottomSheetModal | null>;
  entry: TimeEntry | null;
  onEdit: (entry: TimeEntry) => void;
  onDuplicate: (entry: TimeEntry) => void;
  onToggleBillable: (entry: TimeEntry) => void;
  onSetBilled: (entry: TimeEntry, isBilled: boolean) => void;
  onDelete: (entry: TimeEntry) => void;
};

type ActionRowProps = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
};

function ActionRow({ icon: Icon, label, onPress, danger, testID }: ActionRowProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const tint = danger ? colors.danger[dark ? 400 : 600] : (dark ? colors.neutral[100] : colors.neutral[800]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:bg-muted"
      testID={testID}
    >
      <Icon size={20} color={tint} />
      <Text className={twMerge('text-base', danger ? 'text-danger-600 dark:text-danger-400' : 'text-foreground')}>{label}</Text>
    </Pressable>
  );
}

/** Handlingsark ved long-press på en post: redigér, dupliker, fakturerbar, faktureret, slet. */
export function EntryActionsSheet({ ref, entry, onEdit, onDuplicate, onToggleBillable, onSetBilled, onDelete }: EntryActionsSheetProps) {
  const { theme } = useUniwind();
  const snapPoints = React.useMemo(() => [400], []);
  const close = () => ref.current?.dismiss();
  const run = (fn: (e: TimeEntry) => void) => () => {
    if (!entry)
      return;
    close();
    fn(entry);
  };
  const billableLabel = entry?.isBillable === false
    ? translate('entries.actions.mark_billable')
    : translate('entries.actions.mark_non_billable');
  // `isBilled === true` og ikke falsk-værdi: serverens kolonne er nullable, så
  // `null`/`undefined` er *ikke* faktureret — samme regel som `matchesBilled`.
  const billed = entry?.isBilled === true;
  const billedLabel = billed
    ? translate('entries.actions.unmark_billed')
    : translate('entries.actions.mark_billed');
  return (
    <Modal
      ref={ref}
      snapPoints={snapPoints}
      title={entry ? entryTitle(entry) : translate('entries.actions.title')}
      backgroundStyle={{ backgroundColor: theme === 'dark' ? colors.neutral[900] : colors.white }}
    >
      <BottomSheetView>
        <View className="px-3 pb-6">
          <ActionRow icon={Pencil} label={translate('entries.actions.edit')} onPress={run(onEdit)} testID="action-edit" />
          <ActionRow icon={Copy} label={translate('entries.actions.duplicate')} onPress={run(onDuplicate)} testID="action-duplicate" />
          <ActionRow icon={BadgeDollarSign} label={billableLabel} onPress={run(onToggleBillable)} testID="action-billable" />
          <ActionRow
            icon={billed ? ReceiptText : Receipt}
            label={billedLabel}
            onPress={run(e => onSetBilled(e, !billed))}
            testID="action-billed"
          />
          <ActionRow icon={Trash2} label={translate('entries.actions.delete')} onPress={run(onDelete)} danger testID="action-delete" />
        </View>
      </BottomSheetView>
    </Modal>
  );
}
