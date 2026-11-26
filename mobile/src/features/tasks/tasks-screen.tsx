import type { TaskListItem, TaskRowItem } from './components/task-row';
import type { TaskSegment } from './task-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { useRouter } from 'expo-router';
import { CheckSquare, Plus } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListSkeleton,
  Screen,
  Segmented,
  Select,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { TaskRow } from './components/task-row';
import { normalizeTaskList } from './normalize-task-list';
import { filterTasks, sortByDeadline, TASK_SEGMENTS } from './task-logic';

const ALL_PROJECTS = '';

type TaskCursor = Extract<RouterOutputs['tasks']['list'], { nextCursor: unknown }>['nextCursor'];

function useTaskPages(projectId: string, enabled: boolean) {
  const { client } = trpc.useUtils();
  const input = { projectId: projectId || undefined, orderBy: 'deadline' as const };
  // The legacy router type has no cursor, so tRPC only exposes useQuery for it.
  return useInfiniteQuery({
    queryKey: getQueryKey(trpc.tasks.list, input, 'infinite'),
    initialPageParam: null as TaskCursor | null,
    enabled,
    queryFn: async ({ pageParam, signal }) => {
      const pageInput = pageParam == null ? input : { ...input, cursor: pageParam };
      const page = await client.tasks.list.query(pageInput, { signal });
      return normalizeTaskList<TaskListItem, TaskCursor>(page);
    },
    getNextPageParam: page => page.nextCursor,
  });
}

export function TasksScreen() {
  const caps = useCapabilities();
  const enabled = caps.isEnabled('tasks');
  const router = useRouter();
  const [segment, setSegment] = React.useState<TaskSegment>('open');
  const [projectId, setProjectId] = React.useState<string>(ALL_PROJECTS);

  const list = useTaskPages(projectId, enabled);
  const focus = trpc.tasks.getTodaysFocus.useQuery(undefined, { enabled: enabled && segment === 'today' });
  const projects = trpc.projects.list.useQuery(undefined, { enabled });

  // Skeleton → indhold er lydløst for en skærmlæser, så den hører, når
  // opgaverne er kommet. Før denne linje lå skærmen stille i to sekunder.
  useAnnounceLoaded(segment === 'today' ? focus : list, translate('common.loaded'));

  const segmentOptions = React.useMemo(
    () => TASK_SEGMENTS.map(s => ({ value: s, label: translate(`tasks.segment.${s}`) })),
    [],
  );
  const projectOptions = React.useMemo(
    () => [{ label: translate('tasks.all_projects'), value: ALL_PROJECTS }, ...(projects.data ?? []).map(p => ({ label: p.name, value: p.id }))],
    [projects.data],
  );

  const canLoadMore = segment !== 'today' && list.hasNextPage;
  const visible = React.useMemo(() => {
    if (segment === 'today')
      return (focus.data ?? []).filter(t => !projectId || t.projectId === projectId);
    const rows = list.data?.pages.flatMap(page => page.rows) ?? [];
    // Cursor-sider kan overlappe, når opgaver ændres mellem to hentninger.
    const unique = new Map(rows.map(row => [row.id, row]));
    const filtered = filterTasks([...unique.values()], segment);
    return segment === 'done' ? filtered : sortByDeadline(filtered);
  }, [segment, focus.data, list.data, projectId]);

  const refresh = React.useCallback(() => {
    void list.refetch();
    if (segment === 'today')
      void focus.refetch();
  }, [list, focus, segment]);

  if (!enabled) {
    return (
      <Screen title={translate('tasks.title')} back>
        <EmptyState icon={CheckSquare} title={translate('tasks.module_off_title')} description={translate('tasks.module_off_body')} />
      </Screen>
    );
  }

  const isLoading = segment === 'today' ? focus.isLoading : list.isLoading;
  const isError = segment === 'today' ? focus.isError : list.isError && !list.data;

  return (
    <Screen
      title={translate('tasks.title')}
      back
      refreshing={list.isRefetching}
      onRefresh={refresh}
      right={<IconButton icon={Plus} label={translate('tasks.new')} variant="primary" onPress={() => router.push('/tasks/new')} testID="tasks-add" />}
      header={<Segmented options={segmentOptions} value={segment} onChange={setSegment} testID="tasks-segment" />}
    >
      <QuickAdd projectId={projectId || undefined} />
      <Select options={projectOptions} value={projectId} error={projects.isError ? translate('common.error_load') : undefined} onSelect={v => setProjectId(String(v))} placeholder={translate('tasks.all_projects')} testID="tasks-project" />
      {isLoading
        ? <ListSkeleton rows={4} />
        : isError
          ? <ErrorState onRetry={refresh} />
          : visible.length === 0
            ? (canLoadMore ? <Text className="text-sm text-muted-foreground">{translate('tasks.none_in_loaded')}</Text> : <EmptyState icon={CheckSquare} title={translate(`tasks.empty.${segment}`)} description={translate('tasks.empty.body')} compact />)
            : <TaskList tasks={visible} />}
      {canLoadMore && (list.isFetchNextPageError
        ? <ErrorState onRetry={() => void list.fetchNextPage({ cancelRefetch: false })} />
        : (
            <Button
              label={translate('tasks.show_more')}
              variant="outline"
              loading={list.isFetchingNextPage}
              disabled={list.isFetching}
              onPress={() => void list.fetchNextPage({ cancelRefetch: false })}
              testID="tasks-show-more"
            />
          ))}
    </Screen>
  );
}

function QuickAdd({ projectId }: { projectId?: string }) {
  const [text, setText] = React.useState('');
  const utils = trpc.useUtils();
  const quickAdd = trpc.tasks.quickAdd.useMutation({
    onSuccess: () => {
      setText('');
      void utils.tasks.invalidate();
      showMessage({ message: translate('tasks.created_ok'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
  const submit = () => {
    const value = text.trim();
    if (!value)
      return;
    quickAdd.mutate({ text: value, projectId });
  };
  return (
    <Input
      value={text}
      onChangeText={setText}
      placeholder={translate('tasks.quick_add_placeholder')}
      returnKeyType="done"
      onSubmitEditing={submit}
      editable={!quickAdd.isPending}
      testID="tasks-quick-add"
    />
  );
}

function useTaskRowActions() {
  const utils = trpc.useUtils();
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const invalidate = () => void utils.tasks.invalidate();
  const markDone = trpc.tasks.markDone.useMutation({ onSuccess: invalidate, onError });
  const reopen = trpc.tasks.reopen.useMutation({ onSuccess: invalidate, onError });
  const remove = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('tasks.deleted_ok'), type: 'success' });
    },
    onError,
  });
  return {
    toggle: (id: string, done: boolean) => (done ? markDone.mutate({ id }) : reopen.mutate({ id })),
    confirmDelete: (task: { id: string; title: string }) =>
      Alert.alert(translate('tasks.delete'), translate('tasks.confirm_delete', { title: task.title }), [
        { text: translate('tasks.cancel'), style: 'cancel' },
        { text: translate('tasks.delete'), style: 'destructive', onPress: () => remove.mutate({ id: task.id }) },
      ]),
  };
}

function TaskList({ tasks }: { tasks: TaskRowItem[] }) {
  const router = useRouter();
  const actions = useTaskRowActions();
  return (
    <Card className="p-0">
      <View>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            task={t}
            onPress={() => router.push(`/tasks/${t.id}`)}
            onLongPress={() => actions.confirmDelete(t)}
            onToggle={done => actions.toggle(t.id, done)}
            last={i === tasks.length - 1}
          />
        ))}
      </View>
    </Card>
  );
}
