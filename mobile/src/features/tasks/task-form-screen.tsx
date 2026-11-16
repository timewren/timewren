import type { DateChip, TaskPriority } from './task-logic';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Input, Screen, Select, Text } from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateRelative, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { dateForChip, parseHoursToMinutes, parseISODateInput, TASK_PRIORITIES } from './task-logic';

const NO_PROJECT = '';
const CHIPS: DateChip[] = ['today', 'tomorrow', 'next_week'];

/** Opret opgave (modal). Forudfyld projekt via `?projectId=`. */
export function TaskFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [projectId, setProjectId] = React.useState<string>(params.projectId ?? NO_PROJECT);
  const [priority, setPriority] = React.useState<TaskPriority>('medium');
  const [deadline, setDeadline] = React.useState<Date | null>(null);
  const [estimate, setEstimate] = React.useState('');

  const utils = trpc.useUtils();
  const projects = trpc.projects.list.useQuery(undefined);
  const create = trpc.tasks.create.useMutation({
    onSuccess: (task) => {
      void utils.tasks.invalidate();
      showMessage({ message: translate('tasks.created_ok'), type: 'success' });
      router.replace(`/tasks/${task.id}`);
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  const projectOptions = React.useMemo(
    () => [{ label: translate('tasks.no_project'), value: NO_PROJECT }, ...(projects.data ?? []).map(p => ({ label: p.name, value: p.id }))],
    [projects.data],
  );
  const priorityOptions = React.useMemo(() => TASK_PRIORITIES.map(p => ({ value: p, label: translate(`tasks.priority.${p}`) })), []);

  const submit = () => {
    if (!title.trim())
      return;
    create.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      projectId: projectId || null,
      priority,
      deadline,
      estimatedMinutes: parseHoursToMinutes(estimate),
    });
  };

  return (
    <Screen title={translate('tasks.new')} back>
      <Input label={translate('tasks.form.title')} placeholder={translate('tasks.form.title_placeholder')} value={title} onChangeText={setTitle} autoFocus testID="task-form-title" />
      <Select label={translate('tasks.form.project')} options={projectOptions} value={projectId} error={projects.isError ? translate('common.error_load') : undefined} onSelect={v => setProjectId(String(v))} placeholder={translate('tasks.no_project')} testID="task-form-project" />
      <Select label={translate('tasks.form.priority')} options={priorityOptions} value={priority} onSelect={v => setPriority(v as TaskPriority)} testID="task-form-priority" />
      <DeadlineField value={deadline} onChange={setDeadline} />
      <Input label={translate('tasks.form.estimate')} value={estimate} onChangeText={setEstimate} keyboardType="decimal-pad" placeholder="1,5" testID="task-form-estimate" />
      <Input label={translate('tasks.form.description')} value={description} onChangeText={setDescription} multiline testID="task-form-description" />
      <Button label={translate('tasks.form.save')} onPress={submit} loading={create.isPending} disabled={!title.trim()} testID="task-form-save" />
    </Screen>
  );
}

type DeadlineFieldProps = { value: Date | null; onChange: (d: Date | null) => void; initialText?: string };

/** Deadline uden native date-picker: chips (i dag/i morgen/om en uge) + åååå-mm-dd-felt. */
export function DeadlineField({ value, onChange, initialText = '' }: DeadlineFieldProps) {
  const [text, setText] = React.useState(initialText);
  const chipValue = React.useCallback(
    (chip: DateChip) => {
      const d = dateForChip(chip);
      setText(toISODate(d));
      onChange(d);
    },
    [onChange],
  );
  const onText = (t: string) => {
    setText(t);
    if (!t.trim()) {
      onChange(null);
      return;
    }
    const parsed = parseISODateInput(t);
    if (parsed)
      onChange(parsed);
  };
  const invalid = text.trim().length > 0 && !parseISODateInput(text);
  return (
    <View className="mb-2">
      <Text className="mb-1 text-lg text-foreground" tx="tasks.deadline" />
      <View className="mb-2 flex-row flex-wrap gap-2">
        {CHIPS.map(chip => (
          <Chip
            key={chip}
            label={translate(`tasks.chips.${chip}`)}
            onPress={() => chipValue(chip)}
            active={value != null && toISODate(value) === toISODate(dateForChip(chip))}
            testID={`deadline-chip-${chip}`}
          />
        ))}
        <Chip label={translate('tasks.chips.clear')} onPress={() => onText('')} active={!value} testID="deadline-chip-clear" />
      </View>
      <Input
        value={text}
        onChangeText={onText}
        placeholder={translate('tasks.form.deadline_hint')}
        keyboardType="numbers-and-punctuation"
        error={invalid ? translate('tasks.form.deadline_hint') : undefined}
        testID="deadline-input"
      />
      {value ? <Text className="-mt-1 text-xs text-muted-foreground">{formatDateRelative(value)}</Text> : null}
    </View>
  );
}

function Chip({ label, onPress, active, testID }: { label: string; onPress: () => void; active?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      className={`rounded-full border px-3 py-1.5 ${active ? 'border-primary-600 bg-primary-100 dark:bg-primary-900' : 'border-border bg-card'}`}
      testID={testID}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}
