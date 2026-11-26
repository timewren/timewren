import type { TaskPriority } from './task-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pencil, Play, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  IconButton,
  Input,
  ListSkeleton,
  Screen,
  SectionHeader,
  Select,
  Text,
} from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateRelative, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { TaskAttachments } from './components/task-attachments';
import { TaskComments } from './components/task-comments';
import { DeadlineField } from './task-form-screen';
import {
  deadlineTone,
  formatMinutes,
  isDone,
  isOverdue,
  parseHoursToMinutes,
  priorityTone,
  priorityTx,
  resolveLaneId,
  TASK_PRIORITIES,
} from './task-logic';

type Task = RouterOutputs['tasks']['getById'];

export function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = trpc.tasks.getById.useQuery({ id }, { enabled: !!id });
  const [editing, setEditing] = React.useState(false);
  const refresh = React.useCallback(() => void task.refetch(), [task]);

  useAnnounceLoaded(task, translate('common.loaded'));

  return (
    <Screen
      title={task.data?.title ?? translate('navigation.task')}
      back
      refreshing={task.isRefetching}
      onRefresh={refresh}
      right={task.data ? <IconButton icon={Pencil} label={translate('tasks.edit')} onPress={() => setEditing(e => !e)} testID="task-edit" /> : null}
    >
      {task.isLoading
        ? <ListSkeleton rows={3} />
        : task.isError || !task.data
          ? <ErrorState message={errorMessage(task.error)} onRetry={refresh} />
          : editing
            ? <TaskEditForm task={task.data} onDone={() => setEditing(false)} />
            : <TaskDetail task={task.data} />}
    </Screen>
  );
}

function useTaskUpdate(taskId: string) {
  const utils = trpc.useUtils();
  return trpc.tasks.update.useMutation({
    onSuccess: () => {
      void utils.tasks.invalidate();
      void utils.tasks.getById.invalidate({ id: taskId });
      showMessage({ message: translate('tasks.updated_ok'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
}

function TaskDetail({ task }: { task: Task }) {
  const router = useRouter();
  const done = isDone(task);
  const timerHref = `/entries/new?taskId=${task.id}${task.projectId ? `&projectId=${task.projectId}` : ''}` as const;
  return (
    <>
      <Card>
        <View className="flex-row flex-wrap gap-2">
          <Badge label={translate(priorityTx(task.priority))} tone={priorityTone(task.priority)} />
          {task.deadline
            ? <Badge label={isOverdue(task) ? `${translate('tasks.overdue_badge')} · ${formatDateRelative(task.deadline)}` : formatDateRelative(task.deadline)} tone={deadlineTone(task)} />
            : <Badge label={translate('tasks.no_deadline')} />}
        </View>
        <Text className="mt-3 text-base text-foreground">{task.description || translate('tasks.no_description')}</Text>
        <View className="mt-4 flex-row gap-4">
          <Meta label={translate('tasks.project')} value={task.project?.name ?? translate('tasks.no_project')} onPress={task.projectId ? () => router.push(`/projects/${task.projectId}`) : undefined} hint={translate('tasks.open_project_hint')} />
          {task.client ? <Meta label={translate('tasks.client')} value={task.client.name} onPress={() => router.push(`/clients/${task.client!.id}`)} hint={translate('tasks.open_client_hint')} /> : null}
        </View>
        <View className="mt-3 flex-row gap-4">
          <Meta label={translate('tasks.estimate')} value={formatMinutes(task.estimatedMinutes)} />
          <Meta label={translate('tasks.tracked')} value={formatMinutes(task.actualMinutes)} />
        </View>
        {!done
          ? (
              <Button className="mt-4" label={translate('tasks.start_timer')} onPress={() => router.push(timerHref)} testID="task-start-timer">
                <View className="flex-row items-center gap-2">
                  <Play size={16} color="white" fill="white" />
                  <Text className="font-semibold text-white" tx="tasks.start_timer" />
                </View>
              </Button>
            )
          : null}
      </Card>
      <StatusPicker task={task} />
      <Subtasks task={task} />
      <TaskAttachments taskId={task.id} />
      <TaskComments taskId={task.id} />
      <DangerZone task={task} />
    </>
  );
}

function Meta({ label, value, onPress, hint }: { label: string; value: string; onPress?: () => void; hint?: string }) {
  return (
    <View className="flex-1">
      <Text className="text-xs font-medium text-muted-foreground uppercase">{label}</Text>
      <Text className={onPress ? 'text-sm text-primary-600 dark:text-primary-400' : 'text-sm text-foreground'} onPress={onPress} accessibilityHint={hint} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function StatusPicker({ task }: { task: Task }) {
  const utils = trpc.useUtils();
  const lanes = trpc.taskStatuses.listForContext.useQuery({ projectId: task.projectId ?? null });
  const move = trpc.tasks.move.useMutation({
    onSuccess: () => {
      void utils.tasks.invalidate();
      showMessage({ message: translate('tasks.updated_ok'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
  const options = React.useMemo(() => (lanes.data ?? []).map(l => ({ label: l.name, value: l.id })), [lanes.data]);
  const current = lanes.data ? resolveLaneId(task, lanes.data) : undefined;
  return (
    <View className="mt-4">
      <Select label={translate('tasks.status')} options={options} value={current} error={lanes.isError ? translate('common.error_load') : undefined} onSelect={v => move.mutate({ taskId: task.id, statusId: String(v) })} placeholder="…" testID="task-status" />
    </View>
  );
}

function Subtasks({ task }: { task: Task }) {
  const [title, setTitle] = React.useState('');
  const utils = trpc.useUtils();
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const invalidate = () => {
    void utils.tasks.invalidate();
    void utils.tasks.getById.invalidate({ id: task.id });
  };
  const create = trpc.tasks.createSubtask.useMutation({
    onSuccess: () => {
      setTitle('');
      invalidate();
    },
    onError,
  });
  const markDone = trpc.tasks.markDone.useMutation({ onSuccess: invalidate, onError });
  const reopen = trpc.tasks.reopen.useMutation({ onSuccess: invalidate, onError });
  const subtasks = task.subtasks ?? [];
  return (
    <>
      <SectionHeader title={translate('tasks.subtasks')} />
      <Card className="p-0">
        {subtasks.map(s => (
          <Checkbox
            key={s.id}
            checked={s.status === 'done'}
            onChange={checked => (checked ? markDone.mutate({ id: s.id }) : reopen.mutate({ id: s.id }))}
            label={s.title}
            accessibilityLabel={s.title}
            className="border-b border-border px-4 py-3"
            testID={`subtask-${s.id}`}
          />
        ))}
        <View className="px-3 pt-3">
          <Input
            value={title}
            onChangeText={setTitle}
            placeholder={translate('tasks.add_subtask')}
            returnKeyType="done"
            onSubmitEditing={() => title.trim() && create.mutate({ parentTaskId: task.id, title: title.trim() })}
            editable={!create.isPending}
            testID="subtask-input"
          />
        </View>
      </Card>
    </>
  );
}

function DangerZone({ task }: { task: Task }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const remove = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      void utils.tasks.invalidate();
      showMessage({ message: translate('tasks.deleted_ok'), type: 'success' });
      router.back();
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
  const confirm = () =>
    Alert.alert(translate('tasks.delete'), translate('tasks.confirm_delete', { title: task.title }), [
      { text: translate('tasks.cancel'), style: 'cancel' },
      { text: translate('tasks.delete'), style: 'destructive', onPress: () => remove.mutate({ id: task.id }) },
    ]);
  return (
    <Button className="mt-8" variant="destructive" label={translate('tasks.delete')} onPress={confirm} loading={remove.isPending} testID="task-delete">
      <View className="flex-row items-center gap-2">
        <Trash2 size={16} color="white" />
        <Text className="font-semibold text-white" tx="tasks.delete" />
      </View>
    </Button>
  );
}

function TaskEditForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? '');
  const [priority, setPriority] = React.useState<TaskPriority>((task.priority as TaskPriority) ?? 'medium');
  const [deadline, setDeadline] = React.useState<Date | null>(() => (task.deadline ? new Date(task.deadline) : null));
  const [estimate, setEstimate] = React.useState(() => (task.estimatedMinutes ? String(Math.round((task.estimatedMinutes / 60) * 100) / 100).replace('.', ',') : ''));
  const update = useTaskUpdate(task.id);
  const priorityOptions = React.useMemo(() => TASK_PRIORITIES.map(p => ({ value: p, label: translate(`tasks.priority.${p}`) })), []);

  const save = () => {
    if (!title.trim())
      return;
    update.mutate(
      {
        id: task.id,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        deadline,
        estimatedMinutes: parseHoursToMinutes(estimate),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <Card>
      <Input label={translate('tasks.form.title')} value={title} onChangeText={setTitle} testID="task-edit-title" />
      <Input label={translate('tasks.form.description')} value={description} onChangeText={setDescription} multiline testID="task-edit-description" />
      <Select label={translate('tasks.form.priority')} options={priorityOptions} value={priority} onSelect={v => setPriority(v as TaskPriority)} testID="task-edit-priority" />
      <DeadlineField value={deadline} onChange={setDeadline} initialText={deadline ? toISODate(deadline) : ''} />
      <Input label={translate('tasks.form.estimate')} value={estimate} onChangeText={setEstimate} keyboardType="decimal-pad" testID="task-edit-estimate" />
      <Button label={translate('tasks.save')} onPress={save} loading={update.isPending} disabled={!title.trim()} testID="task-edit-save" />
      <Button variant="ghost" label={translate('tasks.cancel')} onPress={onDone} />
    </Card>
  );
}
