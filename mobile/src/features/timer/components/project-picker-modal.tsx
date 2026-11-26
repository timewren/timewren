import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { TimerSelection } from '../timer-logic';
import type { CachedClient as Client, CachedProject as Project } from '~/lib/api/offline-read-data';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Briefcase, ChevronLeft, FolderOpen, Search } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { ColorDot, colors, EmptyState, ErrorState, ListRow, ListSkeleton, Modal, Text } from '~/components/ui';
import { BottomSheetTextInput } from '~/components/ui/bottom-sheet';
import { OfflineReadNotice } from '~/features/offline/components/offline-read-notice';
import { useClientChoices, useProjectChoices } from '~/lib/api/use-offline-read';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';
import { useAnnounceVisible } from '~/lib/notify';

export type PickerSelection = Pick<TimerSelection, 'clientId' | 'clientName' | 'projectId' | 'projectName'>;

type Props = {
  ref: React.RefObject<BottomSheetModal | null>;
  onDismiss?: () => void;
  onSelect: (selection: PickerSelection) => void;
};

const HIDDEN_PROJECT_STATUS = new Set(['archived', 'completed']);

function useSearchColors() {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  return {
    dark,
    icon: dark ? colors.neutral[400] : colors.neutral[600],
    text: dark ? colors.neutral[100] : colors.neutral[900],
    field: dark ? colors.neutral[800] : colors.neutral[100],
  };
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const c = useSearchColors();
  return (
    <View className="mx-4 mb-3 flex-row items-center gap-2 rounded-xl px-3" style={{ backgroundColor: c.field }}>
      <Search size={18} color={c.icon} />
      <BottomSheetTextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        placeholderTextColor={c.icon}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        style={{ flex: 1, minHeight: 48, paddingVertical: 10, fontSize: 16, color: c.text, fontFamily: 'Inter' }}
        testID="picker-search"
      />
    </View>
  );
}

function matches(name: string, query: string) {
  return name.toLocaleLowerCase(intlLocale()).includes(query.trim().toLocaleLowerCase(intlLocale()));
}

/**
 * Bundark til valg af kunde → projekt før timeren startes (eller for at
 * skifte undervejs). Første trin viser kunder + "Intern tid"; andet trin
 * viser kundens projekter + "Kun kunden".
 */
export function ProjectPickerModal({ ref, onDismiss, onSelect }: Props) {
  const [clientId, setClientId] = React.useState<string | null>(null);
  const clients = useClientChoices();
  const client = clients.data?.find(candidate => candidate.id === clientId);
  if (clientId && !client)
    setClientId(null);
  const [query, setQuery] = React.useState('');
  const c = useSearchColors();

  const choose = React.useCallback((selection: PickerSelection) => {
    onSelect(selection);
    ref.current?.dismiss();
    setClientId(null);
    setQuery('');
  }, [onSelect, ref]);

  const back = () => {
    setClientId(null);
    setQuery('');
  };

  const header = client
    ? (
        <Pressable onPress={back} className="mx-4 mb-2 min-h-12 flex-row items-center gap-1" accessibilityRole="button" testID="picker-back">
          <ChevronLeft size={18} color={c.icon} />
          <Text className="flex-1 text-sm text-muted-foreground">{translate('timer.pick_client')}</Text>
        </Pressable>
      )
    : null;

  return (
    <Modal
      ref={ref}
      snapPoints={['80%']}
      title={client ? client.name : translate('timer.pick_client')}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={() => {
        back();
        onDismiss?.();
      }}
    >
      {header}
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={translate(client ? 'timer.search_projects_placeholder' : 'timer.search_placeholder')}
      />
      {/* Eget stop, ikke hjemmets: arket er en selvstændig overflade, og en
          skærmlæser der hører "Indhold indlæst" fra en kundeliste midt i
          timeren ved ikke hvad der kom. De to trin taler hver for sig, fordi
          de bytter indhold under brugeren — ét stop med én besked ville give
          samme ord to gange, og intet i det hele, når `projects.list` lå i
          cache. Se `useAnnounceVisible`. */}
      {client
        ? <ProjectStep client={client} query={query} onChoose={choose} />
        : <ClientStep clientsQuery={clients} query={query} onPick={setClientId} onChoose={choose} />}
    </Modal>
  );
}

type ClientStepProps = {
  clientsQuery: ReturnType<typeof useClientChoices>;
  query: string;
  onPick: (id: string) => void;
  onChoose: (selection: PickerSelection) => void;
};

function ClientStep({ clientsQuery, query, onPick, onChoose }: ClientStepProps) {
  const { data, isLoading, isError, refetch, offline, savedAt } = clientsQuery;
  useAnnounceVisible({ isLoading, isError }, translate('timer.clients_loaded'));
  const clients = React.useMemo(
    () => (data ?? []).filter(cl => matches(cl.name, query)),
    [data, query],
  );
  if (!offline && isLoading)
    return <View className="px-4"><ListSkeleton rows={4} /></View>;
  // Uden denne ville et fejlet kald vise "Du har ingen kunder endnu" — en
  // påstand om brugerens kunder, der skyldes et netværksproblem.
  if (!offline && isError)
    return <View className="px-4"><ErrorState onRetry={() => void refetch()} /></View>;

  const internal = !query.trim()
    ? (
        <ListRow
          wrapText
          title={translate('timer.internal')}
          subtitle={translate('timer.internal_hint')}
          left={<Briefcase size={18} color={colors.neutral[400]} />}
          onPress={() => onChoose({ clientId: null, clientName: null, projectId: null, projectName: null })}
          chevron={false}
          testID="picker-internal"
        />
      )
    : null;

  return (
    <BottomSheetFlatList
      accessibilityRole="list"
      data={clients}
      keyExtractor={(item: Client) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={(
        <>
          {offline && <OfflineReadNotice savedAt={savedAt} />}
          {internal}
        </>
      )}
      ListEmptyComponent={offline && !data
        ? undefined
        : (
            <EmptyState
              compact
              title={translate(data?.length ? 'timer.no_results' : 'timer.no_clients')}
            />
          )}
      renderItem={({ item }: { item: Client }) => (
        <ListRow
          wrapText
          title={item.name}
          subtitle={item.company ?? undefined}
          left={<ColorDot color={item.color ?? null} />}
          onPress={() => onPick(item.id)}
          testID={`picker-client-${item.id}`}
        />
      )}
    />
  );
}

function ProjectStep({ client, query, onChoose }: { client: Client; query: string; onChoose: (s: PickerSelection) => void }) {
  const { data, isLoading, isError, refetch, offline, savedAt } = useProjectChoices();
  useAnnounceVisible({ isLoading, isError }, translate('timer.projects_loaded', { name: client.name }));
  const projects = React.useMemo(
    () => (data ?? []).filter(p =>
      p.clientId === client.id
      && !HIDDEN_PROJECT_STATUS.has(p.status ?? 'active')
      && matches(p.name, query),
    ),
    [data, client.id, query],
  );
  if (!offline && isLoading)
    return <View className="px-4"><ListSkeleton rows={3} /></View>;
  if (!offline && isError)
    return <View className="px-4"><ErrorState onRetry={() => void refetch()} /></View>;

  const clientOnly = !query.trim()
    ? (
        <ListRow
          wrapText
          title={translate('timer.client_only')}
          left={<FolderOpen size={18} color={colors.neutral[400]} />}
          onPress={() => onChoose({ clientId: client.id, clientName: client.name, projectId: null, projectName: null })}
          chevron={false}
          testID="picker-client-only"
        />
      )
    : null;

  return (
    <BottomSheetFlatList
      accessibilityRole="list"
      data={projects}
      keyExtractor={(item: Project) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={(
        <>
          {offline && <OfflineReadNotice savedAt={savedAt} />}
          {clientOnly}
        </>
      )}
      ListEmptyComponent={offline && !data ? undefined : <EmptyState compact title={translate(query.trim() ? 'timer.no_results' : 'timer.no_projects')} />}
      renderItem={({ item }: { item: Project }) => (
        <ListRow
          wrapText
          title={item.name}
          subtitle={item.description ?? undefined}
          onPress={() => onChoose({ clientId: client.id, clientName: client.name, projectId: item.id, projectName: item.name })}
          chevron={false}
          testID={`picker-project-${item.id}`}
        />
      )}
    />
  );
}
