import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Text } from '~/components/ui';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';

type Tag = RouterOutputs['tags']['list'][number];
export type InheritedTag = { id: string; name: string; color: string };

type TagChipsProps = {
  selected: string[];
  onToggle: (id: string) => void;
  /** Nedarvede fra kunde/projekt: vises, men kan ikke fjernes her. */
  inherited?: InheritedTag[];
};

/** Ét tag: trykbart chip med taggens egen farve som ramme. */
function TagChip({ tag, on, onPress, locked }: {
  tag: { id: string; name: string; color: string };
  on: boolean;
  onPress?: () => void;
  locked?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole={locked ? 'text' : 'checkbox'}
      accessibilityState={locked ? undefined : { checked: on }}
      accessibilityLabel={locked
        ? translate('entries.form.tag_inherited', { name: tag.name })
        : tag.name}
      className="min-h-11 justify-center rounded-full border px-3"
      style={{ borderColor: tag.color, backgroundColor: on ? tag.color : 'transparent' }}
      testID={`tag-${tag.id}`}
    >
      <Text className="text-sm font-medium" style={{ color: on ? '#fff' : tag.color }}>{tag.name}</Text>
    </Pressable>
  );
}

/**
 * Tag-række på registreringsformen. Uden tags i kontoen skjules den helt —
 * en tom række ville læse som en fejl.
 */
export function TagChips({ selected, onToggle, inherited = [] }: TagChipsProps) {
  const tags = trpc.tags.list.useQuery();
  const list: Tag[] = tags.data ?? [];

  if (tags.isError) {
    return (
      <View className="mb-4 gap-2">
        <Text className="text-sm text-danger-600">{translate('entries.form.tag_load_error')}</Text>
        <Button
          size="sm"
          variant="ghost"
          label={translate('common.retry')}
          onPress={() => void tags.refetch()}
          testID="field-tags-retry"
        />
      </View>
    );
  }

  if (list.length === 0 && inherited.length === 0)
    return null;

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-muted-foreground">{translate('entries.form.tags')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {inherited.map(tag => (
          <TagChip key={`arv-${tag.id}`} tag={tag} on locked />
        ))}
        {list.map(tag => (
          <TagChip
            key={tag.id}
            tag={tag}
            on={selected.includes(tag.id)}
            onPress={() => onToggle(tag.id)}
          />
        ))}
      </View>
    </View>
  );
}
