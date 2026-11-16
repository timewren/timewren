import type { ProjectFormErrors, ProjectFormValues } from './project-form-logic';
import type { ProjectStatus, RateSource } from './project-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Button, ErrorState, Input, ListSkeleton, Screen, Select, Text } from '~/components/ui';
import { errorMessage, trpc, useInvalidateDirectory } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { emptyProject, fromProject, toProjectInput, validateProject } from './project-form-logic';
import { PROJECT_STATUSES, resolveRate, statusLabel } from './project-logic';

type Project = RouterOutputs['projects']['getById'];

const NO_CLIENT = '__none__';

/** Opret (`/projects/new?clientId=`) og redigér (`/projects/[id]/edit`). */
export function ProjectFormScreen() {
  const { id, clientId } = useLocalSearchParams<{ id?: string; clientId?: string }>();
  const isEdit = !!id;
  const existing = trpc.projects.getById.useQuery({ id: id ?? '' }, { enabled: isEdit });
  // Samme lydløse pladsholder som kundeformularen: se `client-form-screen`.
  useAnnounceLoaded(existing, translate('common.loaded'));

  if (isEdit && existing.isLoading)
    return <Screen back title={translate('projects.edit_title')}><ListSkeleton rows={3} /></Screen>;
  if (isEdit && (existing.isError || !existing.data))
    return <Screen back title={translate('projects.edit_title')}><ErrorState message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} /></Screen>;

  return <ProjectForm key={existing.data?.id ?? 'new'} existing={existing.data} initialClientId={clientId ?? null} />;
}

function ProjectForm({ existing, initialClientId }: { existing: Project | undefined; initialClientId: string | null }) {
  const router = useRouter();
  const invalidateDirectory = useInvalidateDirectory();
  const [values, setValues] = React.useState<ProjectFormValues>(() => (existing ? fromProject(existing) : emptyProject(initialClientId)));
  const [errors, setErrors] = React.useState<ProjectFormErrors>({});
  const set = <K extends keyof ProjectFormValues>(key: K) => (value: ProjectFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const clients = trpc.clients.list.useQuery();
  const clientOptions = React.useMemo(() => [
    { value: NO_CLIENT, label: translate('projects.no_client') },
    ...(clients.data ?? []).filter(c => !c.isArchived || c.id === values.clientId).map(c => ({ value: c.id, label: c.name })),
  ], [clients.data, values.clientId]);
  const statusOptions = React.useMemo(() => PROJECT_STATUSES.map(s => ({ value: s, label: statusLabel(s) })), []);

  const onSuccess = (message: string) => {
    invalidateDirectory();
    showMessage({ message, type: 'success' });
    router.back();
  };
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const create = trpc.projects.create.useMutation({ onSuccess: () => onSuccess(translate('projects.created')), onError });
  const update = trpc.projects.update.useMutation({ onSuccess: () => onSuccess(translate('projects.saved')), onError });

  const submit = () => {
    const next = validateProject(values);
    setErrors(next);
    if (Object.keys(next).length > 0)
      return;
    const data = toProjectInput(values);
    if (existing)
      update.mutate({ id: existing.id, data });
    else
      create.mutate(data);
  };

  return (
    <Screen back title={existing ? translate('projects.edit_title') : translate('projects.new_title')} scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Input label={translate('projects.name')} value={values.name} onChangeText={set('name')} error={errors.name} autoFocus={!existing} testID="project-name" />
        <Select
          label={translate('projects.client')}
          value={values.clientId ?? NO_CLIENT}
          options={clientOptions}
          placeholder={translate('projects.select_client')}
          error={clients.isError ? translate('common.error_load') : undefined}
          onSelect={v => set('clientId')(v === NO_CLIENT ? null : String(v))}
          testID="project-client"
        />
        <Input label={translate('projects.hourly_rate')} value={values.hourlyRate} onChangeText={set('hourlyRate')} error={errors.hourlyRate} keyboardType="decimal-pad" testID="project-rate" />
        <RateHint projectRate={values.hourlyRate} clientId={values.clientId} />
        <Input label={translate('projects.fixed_price')} value={values.fixedPrice} onChangeText={set('fixedPrice')} error={errors.fixedPrice} keyboardType="decimal-pad" testID="project-fixed" />
        <Input label={translate('projects.monthly_budget')} value={values.monthlyBudgetHours} onChangeText={set('monthlyBudgetHours')} error={errors.monthlyBudgetHours} keyboardType="decimal-pad" testID="project-budget" />
        <Select label={translate('projects.status')} value={values.status} options={statusOptions} onSelect={v => set('status')(v as ProjectStatus)} testID="project-status-select" />
        <Input label={translate('projects.description')} value={values.description} onChangeText={set('description')} multiline style={{ minHeight: 96, textAlignVertical: 'top' }} testID="project-description" />
        <Button label={existing ? translate('projects.save') : translate('projects.create')} loading={create.isPending || update.isPending} onPress={submit} className="mt-4 rounded-xl bg-primary-600" textClassName="text-white" testID="project-submit" />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const RATE_HINT_KEY: Record<Exclude<RateSource, 'none'>, 'projects.rate_own' | 'projects.rate_inherit_client' | 'projects.rate_inherit_global'> = {
  project: 'projects.rate_own',
  client: 'projects.rate_inherit_client',
  global: 'projects.rate_inherit_global',
};

/** Arv-indikator: projekt → kunde → global timepris. */
function RateHint({ projectRate, clientId }: { projectRate: string; clientId: string | null }) {
  const client = trpc.clients.getById.useQuery({ id: clientId ?? '' }, { enabled: !!clientId });
  const profile = trpc.user.getProfile.useQuery();
  const resolved = resolveRate({
    projectRate: projectRate.replace(',', '.'),
    clientRate: client.data?.defaultHourlyRate,
    globalRate: profile.data?.defaultHourlyRate,
  });
  const text = resolved.source === 'none'
    ? translate('projects.rate_inherit_none')
    : translate(RATE_HINT_KEY[resolved.source], { rate: formatMoney(resolved.rate) });
  return <Text className="-mt-1 mb-3 text-xs text-muted-foreground" testID="project-rate-hint">{text}</Text>;
}
