import type { LocalSelection } from '../local-logic';
import type { PickerOption } from '~/features/entries/components/picker-field';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '~/components/ui';
import { PickerField } from '~/features/entries/components/picker-field';
import { translate } from '~/lib/i18n';
import { applyClient, applyProject, toggleTag } from '../local-logic';
import { useLocalStore } from '../local-store';

type Props = {
  value: LocalSelection;
  onChange: (next: LocalSelection) => void;
  testID?: string;
};

/** Projekt → kunde → tags for en lokal registrering eller timer. Skjuler felter uden data. */
export function SelectionFields({ value, onChange, testID = 'local' }: Props) {
  const projects = useLocalStore.use.projects();
  const clients = useLocalStore.use.clients();

  const projectOptions = React.useMemo<PickerOption[]>(
    () => projects.map(p => ({ value: p.id, label: p.name, sublabel: clients.find(c => c.id === p.clientId)?.name })),
    [projects, clients],
  );
  const clientOptions = React.useMemo<PickerOption[]>(
    () => clients.map(c => ({ value: c.id, label: c.name })),
    [clients],
  );

  return (
    <View>
      {projects.length > 0
        ? (
            <PickerField
              label={translate('local.project')}
              value={value.projectId}
              options={projectOptions}
              onChange={id => onChange(applyProject(value, projects.find(p => p.id === id) ?? null))}
              placeholder={translate('local.select_project')}
              noneLabel={translate('local.no_project')}
              testID={`${testID}-project`}
            />
          )
        : null}
      {clients.length > 0
        ? (
            <PickerField
              label={translate('local.client')}
              value={value.clientId}
              options={clientOptions}
              onChange={id => onChange(applyClient(value, id, projects))}
              placeholder={translate('local.select_client')}
              noneLabel={translate('local.no_client')}
              testID={`${testID}-client`}
            />
          )
        : null}
      <TagChips selected={value.tagIds} onToggle={id => onChange(toggleTag(value, id))} />
    </View>
  );
}

export function TagChips({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  const tags = useLocalStore.use.tags();
  if (!tags.length)
    return null;
  return (
    <View className="mb-4 flex-row flex-wrap gap-2">
      {tags.map((t) => {
        const on = selected.includes(t.id);
        return (
          <Pressable
            key={t.id}
            onPress={() => onToggle(t.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            className="min-h-11 flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
            style={{ borderColor: t.color, backgroundColor: on ? t.color : 'transparent' }}
            testID={`local-tag-${t.name}`}
          >
            <Text className="text-sm font-medium" style={{ color: on ? '#fff' : t.color }}>{t.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
