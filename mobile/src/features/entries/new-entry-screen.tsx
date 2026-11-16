import type { EntryFormState } from './form-state';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Screen } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { runOrQueue } from '~/features/offline/run-or-queue';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { applyTagsToEntry } from './apply-tags';
import { EntryForm } from './entry-form';
import { buildPayload, initialFormState } from './form-state';
import { showApiError, useInvalidateEntries } from './use-entries';
import { useEntryFormState } from './use-entry-form';

export type NewEntryScreenProps = {
  /** Forudfyldt start-state (fx "Log opkald"); ellers fra rute-parametrene */
  initialState?: EntryFormState;
  title?: string;
  /** Indhold over formularen */
  intro?: React.ReactNode;
};

export function NewEntryScreen({ initialState, title, intro }: NewEntryScreenProps = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; clientId?: string; projectId?: string }>();
  const caps = useCapabilities();
  const invalidate = useInvalidateEntries();
  const [submitting, setSubmitting] = React.useState(false);
  const form = useEntryFormState(initialState ?? {
    ...initialFormState(params.date),
    clientId: params.clientId ?? null,
    projectId: params.projectId ?? null,
  });

  const create = trpc.time.create.useMutation({
    onError: showApiError,
  });

  const submit = async () => {
    const result = buildPayload(form.state, { klippekort: caps.isEnabled('klippekort') });
    if (!result.ok) {
      form.setError({ key: result.error, field: result.field });
      showMessage({ message: translate(result.error), type: 'danger' });
      return;
    }
    setSubmitting(true);
    try {
      const tagIds = form.state.tagIds;
      // `time.create` tager ikke imod tags, så de sendes som et eget kald
      // bagefter — men kun hvis posten faktisk nåede serveren nu.
      let createdId: string | undefined;
      // Uden net — eller hvis forbindelsen dør undervejs — bliver
      // registreringen liggende i køen i stedet for at gå tabt. Tagsene
      // rider med i `meta`, så dræningen sætter dem når posten oprettes.
      const outcome = await runOrQueue(
        { type: 'time.create', payload: result.payload, meta: tagIds.length ? { tagIds } : undefined },
        async () => {
          createdId = (await create.mutateAsync(result.payload))?.id;
        },
      );
      if (outcome.kind === 'sent') {
        if (tagIds.length)
          await applyTagsToEntry(createdId, tagIds);
        invalidate();
        showMessage({ message: translate('entries.created'), type: 'success' });
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

  return (
    <Screen title={title ?? translate('entries.new_title')} back scrollProps={{ keyboardDismissMode: 'on-drag' }}>
      {intro}
      <EntryForm
        state={form.state}
        onChange={form.onChange}
        error={form.error}
        submitLabel={translate('entries.register')}
        submitting={submitting}
        onSubmit={submit}
      />
    </Screen>
  );
}
