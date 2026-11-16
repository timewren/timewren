import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Checkbox, Text } from '~/components/ui';
import { formatDateRelative } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { deadlineTone, isDone, isOverdue, priorityTone, priorityTx } from '../task-logic';

export type TaskListItem = RouterOutputs['tasks']['list'][number];

/** Mindste fællesnævner for `tasks.list` og `tasks.getTodaysFocus` (sidstnævnte har projekt uden kunde). */
export type TaskRowItem = {
  id: string;
  title: string;
  status: string;
  deadline: Date | string | null;
  priority: string | null;
  project: { id: string; name: string } | null;
};

type Props = {
  task: TaskRowItem;
  onPress: () => void;
  onLongPress?: () => void;
  onToggle: (done: boolean) => void;
  last?: boolean;
};

/** Opgaverække: checkbox (fuldfør/genåbn), titel, projekt, deadline-chip, prioritet. */
export function TaskRow({ task, onPress, onLongPress, onToggle, last }: Props) {
  const done = isDone(task);
  const overdue = isOverdue(task);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-row items-center gap-3 px-4 py-3 active:bg-muted ${last ? '' : 'border-b border-border'}`}
      accessibilityRole="button"
      testID={`task-${task.id}`}
    >
      <Checkbox.Root checked={done} onChange={onToggle} accessibilityLabel={task.title} hitSlop={8} testID={`task-toggle-${task.id}`}>
        <Checkbox.Icon checked={done} />
      </Checkbox.Root>
      <View className="flex-1">
        <Text className={done ? 'text-base text-muted-foreground line-through' : 'text-base text-foreground'} numberOfLines={2}>
          {task.title}
        </Text>
        <View className="mt-1 flex-row flex-wrap items-center gap-2">
          {task.project?.name
            ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{task.project.name}</Text>
            : null}
          {task.deadline
            ? <Badge label={overdue ? translate('tasks.overdue_badge') : formatDateRelative(task.deadline)} tone={deadlineTone(task)} />
            : null}
          {task.priority && task.priority !== 'medium'
            ? <Badge label={translate(priorityTx(task.priority))} tone={priorityTone(task.priority)} />
            : null}
        </View>
      </View>
    </Pressable>
  );
}
