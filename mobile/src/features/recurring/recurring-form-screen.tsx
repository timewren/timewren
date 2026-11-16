import type { Created, Frequency, RecurringFormErrors, RecurringFormValues, TemplateType } from './recurring-form-logic';
import type { OptionType } from '~/components/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Input,
  ListSkeleton,
  Screen,
  SectionHeader,
  Select,
  Switch,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage, useReportLoad } from '~/lib/notify';
import { createdBlock, emptyRecurring, recurringFromTemplate, toCreateInput, toUpdateInput, validateRecurring } from './recurring-form-logic';
import { BLOCK_TEXT, weekdayName } from './recurring-logic';
import { useGenerate } from './use-generate';

const FREQUENCIES: OptionType[] = [
  { value: 'daily', label: translate('recurring.frequency_daily') },
  { value: 'weekly', label: translate('recurring.frequency_weekly') },
  { value: 'monthly', label: translate('recurring.frequency_monthly') },
  { value: 'none', label: translate('recurring.freq_none') },
];

const TYPES: OptionType[] = [
  { value: 'time_entry', label: translate('recurring.form_type_time') },
  { value: 'task', label: translate('recurring.form_type_task') },
  { value: 'both', label: translate('recurring.form_type_both') },
];

/**
 * Opret og redigér en gentagen registrering — én skærm til begge.
 *
 * Serverens `update` er et delvis update: kun felter der er med, ændres
 * (routeren:465-552). Så det er samme felter, samme validering og samme regler
 * begge steder — og en skærm der kun kunne slette et felt ville få folk til at tro
 * at en skabelon kan nulstilles ved at rydde feltet.
 *
 * Redigering læser `getById` og **sender aldrig `clientIds`**: serveren rører
 * `recurringTemplateClients` kun når feltet kommer med (routeren:595), så en
 * skabelon med flere kunder beholder dem, selv om den redigeres på telefonen.
 */
export function RecurringFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const template = trpc.recurring.getById.useQuery({ id: id ?? '' }, { enabled: editing });
  const list = trpc.recurring.list.useQuery(undefined, { enabled: editing });

  // Skærmen henter skabelonen og viser en pladsholder, så den skal sige højt,
  // at den indlæser (porten i `notify.test.ts`).
  useReportLoad(editing ? template : list, translate('common.loaded'));

  if (editing && template.isLoading)
    return <Screen back title={translate('recurring.edit_title')}><ListSkeleton rows={4} /></Screen>;
  if (editing && template.isError) {
    return (
      <Screen back title={translate('recurring.edit_title')}>
        <ErrorState message={errorMessage(template.error)} onRetry={() => void template.refetch()} />
      </Screen>
    );
  }

  const saved = editing ? template.data : undefined;
  if (editing && !saved)
    return null;

  // `getById` svarer uden `templateClients` (routeren:245-253), så listen bruges
  // til at se, om der står flere kunder på skabelonen. De skal bare *vises* —
  // de sendes aldrig, se docblocken.
  const extraClients = (list.data ?? []).find(t => t.id === id)?.templateClients.length ?? 0;

  return (
    <RecurringForm
      id={id}
      initial={saved ? recurringFromTemplate(saved) : emptyRecurring()}
      title={translate(editing ? 'recurring.edit_title' : 'recurring.new_title')}
      extraClients={extraClients}
    />
  );
}

type FormProps = {
  id?: string;
  initial: RecurringFormValues;
  title: string;
  extraClients: number;
};

type SavedProps = {
  created: Created;
  extraClients: number;
  onBack: () => void;
};

/**
 * Ét opret-kald ad gangen.
 *
 * `recurring.create` er ikke idempotent: hvert kald indsætter en ny række, så
 * to tryk under en ark-animation giver to skabeloner. Da oprettelsen nu **står
 * på skærmen** i stedet for at lukke den, ville den anden skabelon være usynlig
 * for brugeren — han så kun den første gemt. Samme greb som `generateFlight`.
 */
const createFlight = createInFlight<void>();

function RecurringForm({ id, initial, title, extraClients }: FormProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [values, setValues] = React.useState<RecurringFormValues>(initial);
  const [errors, setErrors] = React.useState<RecurringFormErrors>({});
  /** Sættes når `create` svarer — skærmen bliver stående og tilbyder «Registrér nu». */
  const [created, setCreated] = React.useState<Created | null>(null);
  const set = <K extends keyof RecurringFormValues>(key: K) => (value: RecurringFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const create = trpc.recurring.create.useMutation();
  const update = trpc.recurring.update.useMutation({
    onSuccess: () => {
      void utils.recurring.invalidate();
      showMessage({ message: translate('recurring.updated_toast'), type: 'success' });
      router.back();
    },
    onError,
  });

  const saveNew = React.useCallback(async () => {
    await createFlight('create', async () => {
      try {
        const template = await create.mutateAsync(toCreateInput(values));
        void utils.recurring.invalidate();
        setCreated(template);
        showMessage({ message: translate('recurring.created_toast'), type: 'success' });
      }
      catch (error) {
        showMessage({ message: errorMessage(error), type: 'danger' });
      }
    });
  }, [create, utils.recurring, values]);

  const submit = () => {
    const next = validateRecurring(values);
    setErrors(next);
    if (Object.keys(next).length > 0)
      return;
    if (id)
      update.mutate(toUpdateInput(id, values));
    else
      void saveNew();
  };

  if (created) {
    return (
      <SavedPanel created={created} extraClients={extraClients} onBack={() => router.back()} />
    );
  }

  return (
    <Screen back title={title} scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      <Input
        label={translate('recurring.form_name')}
        value={values.name}
        onChangeText={set('name')}
        error={errors.name}
        placeholder={translate('recurring.form_name_placeholder')}
        testID="recurring-name"
      />
      <Input
        label={translate('recurring.form_description')}
        value={values.description}
        onChangeText={set('description')}
        error={errors.description}
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top' }}
        testID="recurring-description"
      />
      <WhoSection values={values} errors={errors} setValues={setValues} />
      <TimeSection values={values} errors={errors} set={set} />
      <WhenSection values={values} errors={errors} set={set} />
      {extraClients > 0
        ? <Text className="mt-1 mb-3 text-[13px] text-muted-foreground" tx="recurring.form_multi_hint" />
        : null}
      {id
        ? (
            <View className="mb-3">
              <Switch
                checked={values.isActive}
                onChange={set('isActive')}
                accessibilityLabel={translate('recurring.form_active')}
                label={translate('recurring.form_active')}
                testID="recurring-active"
              />
            </View>
          )
        : null}
      <Button
        label={translate(id ? 'recurring.form_save' : 'recurring.form_create')}
        loading={create.isPending || update.isPending}
        onPress={submit}
        className="mt-4 rounded-xl bg-primary-600"
        textClassName="text-white"
        testID="recurring-submit"
      />
    </Screen>
  );
}

/**
 * Skabelonen er gemt — og den kan bruges med det samme.
 *
 * Uden denne tilstand skulle brugeren gemme, gå tilbage til katalogen og trykke
 * «Registrér nu» dér — og kun hvis cron'ens `nextDue` allerede var nået. En
 * skabelon med startdato i morgen har ingen «klar nu»-række, så den tiden
 * kunne slet ikke lægges ind fra telefonen. Her kaldes **samme** procedure som
 * rækken gør (`useGenerate`), så der er én kodevej at læse.
 *
 * Knappen vises kun når `generate` faktisk dækker skabelonen: ellers ville den
 * skrive den del, serveren kan, og lade resten ligge (cron'ens søskende,
 * `generateBlock`). Så vises grunden i stedet — samme tre tekster som på rækken.
 */
function SavedPanel({ created, extraClients, onBack }: SavedProps) {
  const { generateRow, busyId } = useGenerate();
  const block = createdBlock(created, extraClients);
  // Cron'en kræver `isNotNull(frequency)` (cron'en:78), så en engangsklage løber
  // aldrig af sig selv. Teksten skal derfor følge hyppigheden — ellers lovede den
  // en automatisk kørsel, der ikke kommer. Det læses på serverens række, som
  // både `generateBlock` og cron'en gør, ikke på formularens værdier.
  const repeats = !!created.frequency;

  return (
    <Screen back title={translate('recurring.saved_title')}>
      <Card testID="recurring-saved">
        <Text className="text-[15px] font-medium text-foreground">{created.name}</Text>
        <Text className="mt-0.5 text-[13px] text-muted-foreground">{formatHours(created.hours)}</Text>
        <Text className="mt-2 text-sm text-muted-foreground" tx={repeats ? 'recurring.saved_body' : 'recurring.saved_body_once'} />
      </Card>
      {block
        ? <Text className="mt-3 text-[13px] text-muted-foreground" tx={BLOCK_TEXT[block]} />
        : (
            <>
              <Button
                label={translate('recurring.generate')}
                loading={busyId === created.id}
                onPress={() => {
                  void generateRow(created.id);
                }}
                className="mt-4 rounded-xl bg-primary-600"
                textClassName="text-white"
                testID="recurring-saved-generate"
              />
              <Text
                className="mt-2 text-[13px] text-muted-foreground"
                tx={repeats ? 'recurring.saved_hint_repeat' : 'recurring.saved_hint'}
              />
            </>
          )}
      <Button
        className="mt-4"
        variant="outline"
        label={translate('recurring.saved_back')}
        onPress={onBack}
        testID="recurring-saved-back"
      />
    </Screen>
  );
}

function onError(error: unknown) {
  showMessage({ message: errorMessage(error), type: 'danger' });
}

type SectionProps = {
  values: RecurringFormValues;
  errors: RecurringFormErrors;
  set: <K extends keyof RecurringFormValues>(key: K) => (value: RecurringFormValues[K]) => void;
};

function WhoSection({ values, errors, setValues }: {
  values: RecurringFormValues;
  errors: RecurringFormErrors;
  setValues: React.Dispatch<React.SetStateAction<RecurringFormValues>>;
}) {
  const clients = trpc.clients.list.useQuery({});
  const projects = trpc.projects.list.useQuery();
  const clientOptions = React.useMemo<OptionType[]>(
    () => (clients.data ?? []).map(c => ({ value: c.id, label: c.name })),
    [clients.data],
  );
  const projectOptions = React.useMemo<OptionType[]>(
    () => (projects.data ?? [])
      .filter(p => !values.clientId || !p.clientId || p.clientId === values.clientId)
      .map(p => ({ value: p.id, label: p.name })),
    [projects.data, values.clientId],
  );

  return (
    <>
      <SectionHeader title={translate('recurring.form_section_who')} />
      <Select
        label={translate('recurring.form_client')}
        value={values.clientId ?? undefined}
        options={clientOptions}
        placeholder={translate('recurring.form_select_client')}
        error={errors.clientId ?? (clients.isError ? translate('common.error_load') : undefined)}
        onSelect={v => setValues(prev => ({ ...prev, clientId: String(v), projectId: null, prepaidPackageId: null }))}
        testID="recurring-client"
      />
      <Select
        label={translate('recurring.form_project')}
        value={values.projectId ?? undefined}
        options={projectOptions}
        placeholder={translate('recurring.form_select_project')}
        error={projects.isError ? translate('common.error_load') : undefined}
        onSelect={v => setValues((prev) => {
          const project = projects.data?.find(p => p.id === String(v));
          return { ...prev, projectId: String(v), clientId: project?.clientId ?? prev.clientId };
        })}
        testID="recurring-project"
      />
    </>
  );
}

function TimeSection({ values, errors, set }: SectionProps) {
  const caps = useCapabilities();
  const packages = trpc.prepaid.list.useQuery({ activeOnly: true }, { enabled: caps.isEnabled('klippekort') });
  const packageOptions = React.useMemo<OptionType[]>(
    () => (packages.data ?? [])
      .filter(p => !values.clientId || !p.clientId || p.clientId === values.clientId)
      .map(p => ({ value: p.id, label: p.name })),
    [packages.data, values.clientId],
  );

  return (
    <>
      <SectionHeader title={translate('recurring.form_section_time')} />
      <Input
        label={translate('recurring.form_hours')}
        value={values.hours}
        onChangeText={set('hours')}
        error={errors.hours}
        keyboardType="decimal-pad"
        placeholder={translate('recurring.form_hours_hint')}
        testID="recurring-hours"
      />
      <Select
        label={translate('recurring.form_template_type')}
        value={values.templateType}
        options={TYPES}
        onSelect={v => set('templateType')(v as TemplateType)}
        testID="recurring-type"
      />
      {caps.isEnabled('klippekort')
        ? (
            <Card className="mb-4">
              <Switch
                checked={values.isPrepaid}
                onChange={set('isPrepaid')}
                accessibilityLabel={translate('recurring.form_prepaid')}
                label={translate('recurring.form_prepaid')}
                testID="recurring-prepaid"
              />
              {values.isPrepaid
                ? (
                    <Select
                      label={translate('recurring.form_package')}
                      value={values.prepaidPackageId ?? undefined}
                      options={packageOptions}
                      placeholder={translate('recurring.form_select_package')}
                      error={packages.isError ? translate('common.error_load') : undefined}
                      onSelect={v => set('prepaidPackageId')(String(v))}
                      testID="recurring-package"
                    />
                  )
                : null}
            </Card>
          )
        : null}
    </>
  );
}

function WhenSection({ values, errors, set }: SectionProps) {
  return (
    <>
      <SectionHeader title={translate('recurring.form_section_when')} />
      <Select
        label={translate('recurring.form_frequency')}
        value={values.frequency ?? 'none'}
        options={FREQUENCIES}
        onSelect={v => set('frequency')(v === 'none' ? null : v as Frequency)}
        testID="recurring-frequency"
      />
      {values.frequency === 'weekly'
        ? (
            <Select
              label={translate('recurring.form_weekday')}
              value={values.dayOfWeek ?? 1}
              options={WEEKDAYS}
              onSelect={v => set('dayOfWeek')(Number(v))}
              error={errors.dayOfWeek}
              testID="recurring-weekday"
            />
          )
        : null}
      {values.frequency === 'monthly'
        ? (
            <Select
              label={translate('recurring.form_day_of_month')}
              value={values.dayOfMonth ?? 1}
              options={DAYS}
              onSelect={v => set('dayOfMonth')(Number(v))}
              error={errors.dayOfMonth}
              testID="recurring-day-of-month"
            />
          )
        : null}
      {values.frequency
        ? (
            <>
              <Input
                label={translate('recurring.form_start_date')}
                value={values.startDate}
                onChangeText={set('startDate')}
                error={errors.startDate}
                placeholder={translate('recurring.form_date_hint')}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                testID="recurring-start"
              />
              <Input
                label={translate('recurring.form_end_date')}
                value={values.endDate}
                onChangeText={set('endDate')}
                error={errors.endDate}
                placeholder={translate('recurring.form_date_hint')}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                testID="recurring-end"
              />
            </>
          )
        : null}
    </>
  );
}

/** 0 = søndag, som i serverens `calculateNextDue` og i `recurring-logic`. */
const WEEKDAYS: OptionType[] = Array.from({ length: 7 }, (_, day) => ({ value: day, label: weekdayName(day) ?? String(day) }));
const DAYS: OptionType[] = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
