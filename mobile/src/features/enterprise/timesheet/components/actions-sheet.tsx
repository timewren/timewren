import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Copy, Save, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, colors, IconButton, ListRow, Modal, SectionHeader, Text } from '~/components/ui';
import { BottomSheetScrollView, BottomSheetTextInput } from '~/components/ui/bottom-sheet';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useTimesheetTemplates } from '../use-timesheet';

type ActionsSheetProps = {
  ref: React.RefObject<BottomSheetModal | null>;
  weekStart: string;
  editable: boolean;
  hasHours: boolean;
  onCopyLastWeek: () => void;
  isCopying: boolean;
};

/** Handlinger for ugen: kopiér sidste uge, skabeloner (anvend/gem/slet). */
export function ActionsSheet(props: ActionsSheetProps) {
  const { ref, weekStart, editable, hasHours, onCopyLastWeek, isCopying } = props;
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const t = useTimesheetTemplates(weekStart);
  const [name, setName] = React.useState('');

  const close = () => ref.current?.dismiss();
  const thenClose = (fn: () => void) => () => {
    fn();
    close();
  };
  const saveTemplate = () => {
    t.save(name.trim());
    setName('');
  };
  const confirmDelete = (id: string, templateName: string) => {
    Alert.alert(translate('enterprise.timesheet.delete_template'), templateName, [
      { text: translate('enterprise.common.cancel'), style: 'cancel' },
      { text: translate('enterprise.timesheet.delete_template'), style: 'destructive', onPress: () => t.remove(id) },
    ]);
  };

  return (
    <Modal
      ref={ref}
      snapPoints={['75%']}
      title={translate('enterprise.timesheet.more_actions')}
      backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView contentContainerClassName="px-4 pb-10">
        <Button
          variant="outline"
          label={translate('enterprise.timesheet.copy_last_week')}
          onPress={thenClose(onCopyLastWeek)}
          loading={isCopying}
          disabled={!editable}
          testID="actions-copy-last-week"
        >
          <View className="flex-row items-center gap-2">
            <Copy size={18} color={dark ? colors.neutral[100] : colors.neutral[900]} />
            <Text className="font-semibold text-foreground">{translate('enterprise.timesheet.copy_last_week')}</Text>
          </View>
        </Button>

        <SectionHeader title={translate('enterprise.timesheet.templates')} />
        {t.templates.length === 0
          ? <Text className="text-sm text-muted-foreground" tx="enterprise.timesheet.templates_empty" />
          : (
              <View className="overflow-hidden rounded-2xl border border-border">
                {t.templates.map((tpl, i, arr) => (
                  <ListRow
                    key={tpl.id}
                    title={tpl.name}
                    subtitle={formatHours(tpl.totalHours)}
                    onPress={editable ? thenClose(() => t.apply(tpl.id)) : undefined}
                    chevron={false}
                    last={i === arr.length - 1}
                    right={<IconButton icon={Trash2} label={translate('enterprise.timesheet.delete_template')} onPress={() => confirmDelete(tpl.id, tpl.name)} size={18} testID={`template-delete-${tpl.id}`} />}
                    testID={`template-${tpl.id}`}
                  />
                ))}
              </View>
            )}

        <SectionHeader title={translate('enterprise.timesheet.save_template')} />
        <View className="flex-row items-center gap-2">
          <BottomSheetTextInput
            value={name}
            onChangeText={setName}
            placeholder={translate('enterprise.timesheet.template_name_placeholder')}
            placeholderTextColor={colors.neutral[400]}
            maxLength={100}
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-3 text-base text-foreground"
            testID="template-name"
          />
          <IconButton
            icon={Save}
            variant="primary"
            label={translate('enterprise.common.save')}
            disabled={!hasHours || name.trim() === '' || t.busy}
            onPress={saveTemplate}
            testID="template-save"
          />
        </View>
      </BottomSheetScrollView>
    </Modal>
  );
}
