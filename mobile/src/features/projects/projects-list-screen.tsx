import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import * as React from 'react';
import { IconButton, Screen, Segmented } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { ScreenLoad } from '~/lib/notify-load';
import { ProjectList } from './components/project-list';

type Filter = 'active' | 'all';

/** Alle projekter på tværs af kunder (Mere → Projekter). */
export function ProjectsListScreen() {
  const router = useRouter();
  const caps = useCapabilities();
  const [filter, setFilter] = React.useState<Filter>('active');
  const query = trpc.projects.list.useQuery();
  const projects = React.useMemo(() => {
    const all = query.data ?? [];
    return filter === 'active' ? all.filter(p => p.status !== 'archived' && p.status !== 'completed') : all;
  }, [query.data, filter]);

  const canCreate = caps.isEnabled('projects');

  return (
    // Ét stop for skærmen. `ProjectList` *melder* sit kald ind i det, så
    // "Indhold indlæst" kun høres her — før denne sag læste både listen OG
    // skærmen, altså to gange for ét og samme kald.
    <ScreenLoad message={translate('common.loaded')}>
      <Screen
        title={translate('projects.list_title')}
        back
        right={canCreate ? <IconButton icon={Plus} label={translate('projects.new_title')} onPress={() => router.push('/projects/new')} testID="projects-new" /> : null}
        header={(
          <Segmented<Filter>
            options={[
              { value: 'active', label: translate('projects.filter_active') },
              { value: 'all', label: translate('projects.filter_all') },
            ]}
            value={filter}
            onChange={setFilter}
            testID="projects-filter"
          />
        )}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
      >
        {/* Listen ejer også fejlen: skærmen erstattede den med sin egen
            `ErrorState`, hvilket meldede regionen *af* midt i en fejl — og
            skærmens stop så et afsluttet kald og sagde "Indhold indlæst". */}
        <ProjectList
          projects={projects}
          isLoading={query.isLoading}
          isError={query.isError}
          errorMessage={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
          showClient
          emptyAction={canCreate ? { label: translate('projects.new_title'), onPress: () => router.push('/projects/new') } : undefined}
        />
      </Screen>
    </ScreenLoad>
  );
}
