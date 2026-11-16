import type { NamedKind } from './local-logic';
import type { PickerOption } from '~/features/entries/components/picker-field';
import { useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, ColorDot, IconButton, Input, ListRow, Screen, Segmented, Text, useModal } from '~/components/ui';
import { PickerField } from '~/features/entries/components/picker-field';
import { PrivateBadge, PrivatePlanSheet } from '~/features/plan/private-plan';
import { usePlan } from '~/features/plan/use-plan';
import { translate } from '~/lib/i18n';
import { validateName } from './local-logic';
import { localStore, useLocalStore } from './local-store';

type Tab = 'projects' | 'clients' | 'tags';
const KIND: Record<Tab, NamedKind> = { projects: 'project', clients: 'client', tags: 'tag' };

/** Projekter, kunder og tags i "uden konto"-tilstand — opret og slet. */
export function LocalManageScreen() {
  const [tab, setTab] = React.useState<Tab>('projects');
  const router = useRouter();
  const privateSheet = useModal();

  const clearAll = () => {
    Alert.alert(translate('local.clear_title'), translate('local.clear_body'), [
      { text: translate('common.cancel'), style: 'cancel' },
      {
        text: translate('common.delete'),
        style: 'destructive',
        onPress: () => {
          localStore().clearAll();
          router.replace('/onboarding');
        },
      },
    ]);
  };

  return (
    <Screen
      back
      title={translate('local.manage')}
      header={(
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'projects', label: translate('local.projects') },
            { value: 'clients', label: translate('local.clients') },
            { value: 'tags', label: translate('local.tags') },
          ]}
          testID="local-manage-tabs"
        />
      )}
    >
      <AddForm key={tab} tab={tab} onAboutPrivate={() => privateSheet.present()} />
      <ItemList tab={tab} />
      <Card className="mt-8 p-0">
        <ListRow
          title={translate('plan.title')}
          subtitle={translate('plan.what_is')}
          right={<PrivateBadge />}
          onPress={() => privateSheet.present()}
          last
          testID="local-manage-private"
        />
      </Card>
      <PrivatePlanSheet ref={privateSheet.ref} />
      <Card className="mt-4">
        <Text className="text-sm font-medium text-foreground" tx="local.account_title" />
        <Text className="mt-0.5 text-[13px] text-muted-foreground" tx="local.account_body" />
        <View className="mt-3 flex-row gap-2">
          <Button size="sm" fullWidth={false} className="my-0" label={translate('local.account_cta')} onPress={() => router.push('/signup')} testID="local-manage-signup" />
          <Button size="sm" variant="outline" fullWidth={false} className="my-0" label={translate('local.log_in')} onPress={() => router.push('/login')} testID="local-manage-login" />
        </View>
      </Card>
      <Button variant="ghost" className="mt-4" textClassName="text-danger-600 dark:text-danger-500" label={translate('local.clear_all')} onPress={clearAll} testID="local-clear-all" />
    </Screen>
  );
}

function useItems(tab: Tab) {
  const projects = useLocalStore(s => s.projects);
  const clients = useLocalStore(s => s.clients);
  const tags = useLocalStore(s => s.tags);
  if (tab === 'projects')
    return projects.map(p => ({ id: p.id, name: p.name, sub: clients.find(c => c.id === p.clientId)?.name, color: undefined as string | undefined }));
  if (tab === 'clients')
    return clients.map(c => ({ id: c.id, name: c.name, sub: undefined, color: undefined }));
  return tags.map(t => ({ id: t.id, name: t.name, sub: undefined, color: t.color }));
}

/** Roligt kort i stedet for opret-feltet, når gratis-grænsen for kunder er nået. */
function ClientLimitCard({ onAboutPrivate }: { onAboutPrivate: () => void }) {
  return (
    <Card className="mb-4" testID="local-client-limit">
      <Text className="text-sm font-medium text-foreground" tx="plan.client_limit_title" />
      <Text className="mt-1 text-[13px] text-muted-foreground" tx="plan.client_limit_body" />
      <Button size="sm" variant="outline" fullWidth={false} className="mt-3 mb-0 self-start" label={translate('plan.client_limit_more')} onPress={onAboutPrivate} testID="local-client-limit-more" />
    </Card>
  );
}

function AddForm({ tab, onAboutPrivate }: { tab: Tab; onAboutPrivate: () => void }) {
  'use no memo';

  const plan = usePlan();
  const [name, setName] = React.useState('');
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const clients = useLocalStore.use.clients();
  const items = useItems(tab);
  const err = validateName(KIND[tab], name, items);
  const clientOptions = React.useMemo<PickerOption[]>(() => clients.map(c => ({ value: c.id, label: c.name })), [clients]);

  if (tab === 'clients' && !plan.canAddClient(clients.length))
    return <ClientLimitCard onAboutPrivate={onAboutPrivate} />;

  const add = () => {
    setTouched(true);
    if (err)
      return;
    if (tab === 'projects')
      localStore().addProject(name, clientId);
    else if (tab === 'clients')
      localStore().addClient(name);
    else
      localStore().addTag(name);
    setName('');
    setTouched(false);
  };

  const placeholderKey = tab === 'projects' ? 'local.project_name' : tab === 'clients' ? 'local.client_name' : 'local.tag_name';
  const labelKey = tab === 'projects' ? 'local.new_project' : tab === 'clients' ? 'local.new_client' : 'local.new_tag';

  return (
    <Card className="mb-4">
      <Input
        label={translate(labelKey)}
        placeholder={translate(placeholderKey)}
        value={name}
        onChangeText={setName}
        onSubmitEditing={add}
        returnKeyType="done"
        error={touched && err ? translate(`local.errors.${err}`) : undefined}
        testID="local-add-name"
      />
      {tab === 'projects' && clients.length > 0
        ? (
            <PickerField
              label={translate('local.client')}
              value={clientId}
              options={clientOptions}
              onChange={setClientId}
              placeholder={translate('local.select_client')}
              noneLabel={translate('local.no_client')}
              testID="local-add-client"
            />
          )
        : null}
      <Button className="my-0" label={translate(labelKey)} onPress={add} testID="local-add-submit" />
    </Card>
  );
}

function ItemList({ tab }: { tab: Tab }) {
  const items = useItems(tab);
  if (!items.length)
    return <Text className="text-center text-muted-foreground" tx="local.none_yet" />;

  const remove = (id: string, name: string) => {
    Alert.alert(translate('local.delete_title', { name }), translate('local.delete_body', { name }), [
      { text: translate('common.cancel'), style: 'cancel' },
      {
        text: translate('common.delete'),
        style: 'destructive',
        onPress: () => {
          if (tab === 'projects')
            localStore().deleteProject(id);
          else if (tab === 'clients')
            localStore().deleteClient(id);
          else
            localStore().deleteTag(id);
        },
      },
    ]);
  };

  return (
    <Card className="p-0">
      {items.map((it, i) => (
        <ListRow
          key={it.id}
          title={it.name}
          subtitle={it.sub}
          left={it.color ? <ColorDot color={it.color} /> : undefined}
          right={(
            <View className="-mr-2">
              <IconButton icon={Trash2} size={18} label={translate('common.delete')} onPress={() => remove(it.id, it.name)} testID={`local-delete-${it.name}`} />
            </View>
          )}
          last={i === items.length - 1}
        />
      ))}
    </Card>
  );
}
