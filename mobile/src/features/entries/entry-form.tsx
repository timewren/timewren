import type { PickerOption } from './components/picker-field';
import type { InheritedTag } from './components/tag-chips';
import type { EntryFormState, FormErrorKey, TimeMode } from './form-state';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Button, Input, Segmented, Switch, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { OfflineReadNotice } from '~/features/offline/components/offline-read-notice';
import { normalizeTaskList } from '~/features/tasks/normalize-task-list';
import { trpc } from '~/lib/api';
import { useClientChoices, useProjectChoices } from '~/lib/api/use-offline-read';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { DateField } from './components/date-field';
import { PickerField } from './components/picker-field';
import { TagChips } from './components/tag-chips';
import { formatHoursInput } from './duration';
import { effectiveHours, toggleTag } from './form-state';
import { useRatePreview } from './use-rate-preview';

const QUICK_HOURS = [0.25, 0.5, 1, 2, 4];

export type EntryFormProps = {
  state: EntryFormState;
  onChange: (patch: Partial<EntryFormState>) => void;
  error: { key: FormErrorKey; field: string } | null;
  submitLabel: string;
  submitting: boolean;
  onSubmit: () => void;
  /** Ekstra knapper under "Gem" (redigér: dupliker/slet) */
  footer?: React.ReactNode;
};

/** Kunde → projekt (filtreret) → opgave (kun med tasks-modul). */
function ContextFields({ state, onChange }: Pick<EntryFormProps, 'state' | 'onChange'>) {
  const caps = useCapabilities();
  const clients = useClientChoices();
  const projects = useProjectChoices();
  const tasksEnabled = caps.isEnabled('tasks') && !!state.projectId;
  const tasks = trpc.tasks.list.useQuery({ projectId: state.projectId ?? undefined }, { enabled: tasksEnabled });

  const clientOptions = React.useMemo<PickerOption[]>(
    () => (clients.data ?? []).map(c => ({ value: c.id, label: c.name })),
    [clients.data],
  );
  const projectOptions = React.useMemo<PickerOption[]>(
    () => (projects.data ?? [])
      .filter(p => !state.clientId || p.clientId === state.clientId)
      .map(p => ({ value: p.id, label: p.name, sublabel: p.client?.name ?? undefined })),
    [projects.data, state.clientId],
  );
  const taskPage = React.useMemo(() => normalizeTaskList(tasks.data), [tasks.data]);
  const taskOptions = React.useMemo<PickerOption[]>(
    () => taskPage.rows.filter(t => t.status !== 'done').map(t => ({ value: t.id, label: t.title })),
    [taskPage],
  );
  // Vælgeren læser kun første side; sig det, så en manglende opgave ikke ligner en fejl.
  const tasksTruncated = taskPage.nextCursor != null;

  const pickClient = (clientId: string | null) => onChange({ clientId, projectId: null, taskId: null, prepaidPackageId: null });
  const pickProject = (projectId: string | null) => {
    const project = projects.data?.find(p => p.id === projectId);
    onChange({ projectId, taskId: null, clientId: project?.clientId ?? state.clientId });
  };

  // Et kald der fejler må ikke vise sig som en tom liste: brugeren ville gemme
  // tiden på intern tid, fordi kunden og projektet ikke kunne vælges.
  const loadError = translate('common.error_load');

  const choicesSavedAt = Math.min(clients.savedAt ?? Infinity, projects.savedAt ?? Infinity);
  const choiceError = (query: typeof clients | typeof projects) =>
    query.offline ? (!query.data ? translate('offline.read_unavailable') : undefined) : (query.isError ? loadError : undefined);

  return (
    <View>
      {clients.offline && Number.isFinite(choicesSavedAt) && <OfflineReadNotice savedAt={choicesSavedAt} />}
      <PickerField
        label={translate('entries.form.client')}
        value={state.clientId}
        options={clientOptions}
        onChange={pickClient}
        placeholder={translate('entries.form.select_client')}
        noneLabel={translate('entries.form.none')}
        error={choiceError(clients)}
        testID="field-client"
      />
      <PickerField
        label={translate('entries.form.project')}
        value={state.projectId}
        options={projectOptions}
        onChange={pickProject}
        placeholder={translate('entries.form.select_project')}
        noneLabel={translate('entries.form.none')}
        hint={!state.clientId && !state.projectId ? translate('entries.form.internal_hint') : undefined}
        error={choiceError(projects)}
        testID="field-project"
      />
      {caps.isEnabled('tasks') && state.projectId
        ? (
            <PickerField
              label={translate('entries.form.task')}
              value={state.taskId}
              options={taskOptions}
              onChange={taskId => onChange({ taskId })}
              placeholder={translate('entries.form.select_task')}
              noneLabel={translate('entries.form.none')}
              hint={tasksTruncated ? translate('entries.form.task_more') : undefined}
              error={tasks.isError ? loadError : undefined}
              testID="field-task"
            />
          )
        : null}
    </View>
  );
}

function QuickHours({ value, onPick }: { value: number | null; onPick: (h: number) => void }) {
  return (
    <View className="mb-3 flex-row gap-2">
      {QUICK_HOURS.map((h) => {
        const active = value !== null && Math.abs(value - h) < 0.001;
        return (
          <Pressable
            key={h}
            onPress={() => onPick(h)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={formatHours(h)}
            className={twMerge(
              'flex-1 items-center rounded-full border p-2',
              active ? 'border-primary-600 bg-primary-600' : 'border-border bg-card active:bg-muted',
            )}
            testID={`quick-${h}`}
          >
            <Text className={twMerge('text-sm font-medium', active ? 'text-white' : 'text-foreground')}>{formatHours(h, { unit: false })}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "2 t × 750 kr. = 1.500 kr." under timerfeltet — skjult offline og uden takst. */
function RateLine({ state }: Pick<EntryFormProps, 'state'>) {
  const preview = useRatePreview({
    hours: effectiveHours(state),
    clientId: state.clientId,
    projectId: state.projectId,
    prepaidPackageId: state.prepaidPackageId,
  });
  if (!preview.line)
    return null;
  return (
    <View accessible accessibilityLabel={preview.source ? `${preview.line}, ${preview.source}` : preview.line} className="mb-1">
      <Text className="text-sm text-muted-foreground" testID="entry-rate-preview">{preview.line}</Text>
      {preview.source
        ? <Text className="text-xs text-muted-foreground" testID="entry-rate-source">{translate('entries.form.rate_source', { source: preview.source })}</Text>
        : null}
    </View>
  );
}

/** Dato + varighed ELLER start/slut. */
function TimeFields({ state, onChange, error }: Pick<EntryFormProps, 'state' | 'onChange' | 'error'>) {
  const modes = React.useMemo(() => [
    { value: 'duration' as TimeMode, label: translate('entries.form.mode_duration') },
    { value: 'range' as TimeMode, label: translate('entries.form.mode_range') },
  ], []);
  const hours = effectiveHours(state);
  const hoursError = error?.field === 'hours' ? translate(error.key) : undefined;
  const rangeError = error?.field === 'range' ? translate(error.key) : undefined;
  return (
    <View>
      <DateField label={translate('entries.form.date')} value={state.date} onChange={date => onChange({ date })} testID="field-date" />
      <Segmented options={modes} value={state.timeMode} onChange={timeMode => onChange({ timeMode })} className="mb-3" testID="time-mode-toggle" />
      {state.timeMode === 'duration'
        ? (
            <View>
              <Input
                label={translate('entries.form.hours')}
                value={state.hoursText}
                onChangeText={hoursText => onChange({ hoursText })}
                placeholder={translate('entries.form.hours_placeholder')}
                keyboardType="decimal-pad"
                error={hoursError}
                testID="field-hours"
              />
              <QuickHours value={hours} onPick={h => onChange({ hoursText: formatHoursInput(h) })} />
              <RateLine state={state} />
            </View>
          )
        : (
            <View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input label={translate('entries.form.start')} value={state.startText} onChangeText={startText => onChange({ startText })} placeholder="09:00" keyboardType="decimal-pad" testID="field-start" />
                </View>
                <View className="flex-1">
                  <Input label={translate('entries.form.end')} value={state.endText} onChangeText={endText => onChange({ endText })} placeholder="12:00" keyboardType="decimal-pad" testID="field-end" />
                </View>
              </View>
              {rangeError ? <Text className="text-sm text-danger-600">{rangeError}</Text> : null}
              {hours !== null && !rangeError ? <Text className="text-sm text-muted-foreground">{formatHours(hours)}</Text> : null}
              {!rangeError ? <RateLine state={state} /> : null}
            </View>
          )}
    </View>
  );
}

/** Klippekort-vælger — kun når modulet er slået til og kunden har aktive pakker. */
function PrepaidField({ state, onChange, editingPackageId }: Pick<EntryFormProps, 'state' | 'onChange'> & { editingPackageId?: string | null }) {
  const caps = useCapabilities();
  const enabled = caps.isEnabled('klippekort') && !!state.clientId;
  const packages = trpc.prepaid.getActiveForClient.useQuery(
    { clientId: state.clientId ?? '', includePackageId: editingPackageId ?? undefined },
    { enabled },
  );
  const options = React.useMemo<PickerOption[]>(
    () => (packages.data ?? []).map(p => ({
      value: p.id,
      label: p.name,
      sublabel: translate('entries.form.prepaid_remaining', { hours: formatHours(p.remainingHours) }),
    })),
    [packages.data],
  );
  if (!enabled)
    return null;
  // Kallet fejlede: feltet må ikke forsvinde som om kunden ikke havde
  // klippekort — brugeren ville gemme tiden på et klippekort uden at vide det.
  if (packages.isError) {
    return (
      <View className="gap-2">
        <PickerField
          label={translate('entries.form.prepaid')}
          value={state.prepaidPackageId}
          options={[]}
          onChange={() => {}}
          placeholder={translate('common.error_load')}
          disabled
          hint={translate('common.error_load')}
          testID="field-prepaid"
        />
        <Button
          size="sm"
          variant="ghost"
          textClassName="text-danger-600 dark:text-danger-500"
          label={translate('common.retry')}
          onPress={() => void packages.refetch()}
          testID="field-prepaid-retry"
        />
      </View>
    );
  }
  if (options.length === 0)
    return null;
  return (
    <PickerField
      label={translate('entries.form.prepaid')}
      value={state.prepaidPackageId}
      options={options}
      onChange={prepaidPackageId => onChange({ prepaidPackageId })}
      placeholder={translate('entries.form.prepaid_none')}
      noneLabel={translate('entries.form.prepaid_none')}
      testID="field-prepaid"
    />
  );
}

export function EntryForm(props: EntryFormProps & { editingPackageId?: string | null; inheritedTags?: InheritedTag[] }) {
  const { state, onChange, error, submitLabel, submitting, onSubmit, footer, editingPackageId, inheritedTags } = props;
  const descriptionError = error?.field === 'description' ? translate(error.key) : undefined;
  return (
    <View className="pb-10">
      <ContextFields state={state} onChange={onChange} />
      <TimeFields state={state} onChange={onChange} error={error} />
      <Input
        label={translate('entries.form.description')}
        value={state.description}
        onChangeText={description => onChange({ description })}
        placeholder={translate('entries.form.description_placeholder')}
        error={descriptionError}
        maxLength={500}
        testID="field-description"
      />
      <Input
        label={translate('entries.form.notes')}
        value={state.notes}
        onChangeText={notes => onChange({ notes })}
        placeholder={translate('entries.form.notes_placeholder')}
        multiline
        numberOfLines={3}
        maxLength={5000}
        testID="field-notes"
      />
      <View className="my-3 flex-row items-center justify-between">
        <Text className="text-base text-foreground">{translate('entries.billable')}</Text>
        <Switch
          checked={state.isBillable}
          onChange={isBillable => onChange({ isBillable })}
          accessibilityLabel={translate('entries.billable')}
          testID="field-billable"
        />
      </View>
      <PrepaidField state={state} onChange={onChange} editingPackageId={editingPackageId} />
      <TagChips
        selected={state.tagIds}
        onToggle={id => onChange({ tagIds: toggleTag(state.tagIds, id) })}
        inherited={inheritedTags}
      />
      <Button label={submitLabel} onPress={onSubmit} loading={submitting} testID="submit-entry" />
      {footer}
    </View>
  );
}
