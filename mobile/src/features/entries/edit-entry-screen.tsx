import type { TimeEntryDetail } from './use-entries';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { Button, EmptyState, ErrorState, ListSkeleton, Screen } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { runOrQueue } from '~/features/offline/run-or-queue';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { applyTagsToEntry } from './apply-tags';
import { EntryForm } from './entry-form';
import { buildPayload, formStateFromEntry, manualTagIds, sameTags, toUpdateData } from './form-state';
import { confirmDelete, showApiError, useEntryActions, useInvalidateEntries } from './use-entries';
import { useEntryFormState } from './use-entry-form';

function EditForm({ entry }: { entry: TimeEntryDetail }) {
  const router = useRouter();
  const caps = useCapabilities();
  const klippekort = caps.isEnabled('klippekort');
  const invalidate = useInvalidateEntries();
  const form = useEntryFormState(formStateFromEntry(entry));
  const actions = useEntryActions();

  const update = trpc.time.update.useMutation({ onError: showApiError });
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    const result = buildPayload(form.state, { klippekort });
    if (!result.ok) {
      form.setError({ key: result.error, field: result.field });
      showMessage({ message: translate(result.error), type: 'danger' });
      return;
    }
    const input = { id: entry.id, data: toUpdateData(result.payload, form.state, klippekort) };
    // `time.update` kender ikke tags, så de sættes i et eget kald — og kun
    // når de faktisk er ændret, så en redigering af beskrivelsen ikke rører dem.
    const tagsChanged = !sameTags(form.state.tagIds, manualTagIds(entry));
    // En tom liste er her *ændringen* (brugeren fjernede alle tags), så
    // `meta` sættes på ændringen — ikke på længden af listen.
    const meta = tagsChanged ? { tagIds: form.state.tagIds } : undefined;
    setSubmitting(true);
    try {
      // Offline lægges tagsene i `meta`, så dræningen sætter dem lige efter
      // rettelsen — ellers sagde kvitteringen «Gemt» om en post hvis tags
      // aldrig nåede serveren.
      const outcome = await runOrQueue({ type: 'time.update', payload: input, meta }, () => update.mutateAsync(input));
      if (outcome.kind === 'sent') {
        if (tagsChanged)
          await applyTagsToEntry(entry.id, form.state.tagIds);
        invalidate();
        showMessage({ message: translate('entries.saved'), type: 'success' });
      }
      router.back();
    }
    catch (error) {
      showApiError(error);
    }
    finally {
      setSubmitting(false);
    }
  };

  const duplicate = () => actions.duplicate(entry.id, () => router.back());
  const remove = () => confirmDelete(() => actions.removeOrQueue(entry.id, () => router.back()));

  const footer = (
    <View className="mt-2 gap-1">
      <Button variant="outline" label={translate('entries.actions.duplicate')} onPress={duplicate} loading={actions.duplicatePending} testID="edit-duplicate" />
      <Button variant="ghost" label={translate('entries.actions.delete')} textClassName="text-danger-600 no-underline" onPress={remove} loading={actions.remove.isPending} testID="edit-delete" />
    </View>
  );

  return (
    <EntryForm
      state={form.state}
      onChange={form.onChange}
      error={form.error}
      submitLabel={translate('entries.save')}
      submitting={submitting}
      onSubmit={submit}
      editingPackageId={entry.prepaidPackageId}
      inheritedTags={entry.tags.filter(t => t.inherited).map(t => ({ id: t.id, name: t.name, color: t.color }))}
      footer={footer}
    />
  );
}

export function EditEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = trpc.time.getById.useQuery({ id: id ?? '' }, { enabled: !!id });
  useAnnounceLoaded(query, translate('common.loaded'));
  return (
    <Screen title={translate('entries.edit_title')} back scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      {query.isLoading
        ? <ListSkeleton rows={4} />
        : query.isError
          ? <ErrorState message={errorMessage(query.error)} onRetry={query.refetch} />
          : query.data
            ? <EditForm key={query.data.id} entry={query.data} />
            : <EmptyState title={translate('entries.empty_title')} description={translate('entries.not_found')} compact />}
    </Screen>
  );
}
