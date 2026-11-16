import type { CallLinkParams } from './call-link';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { PhoneCall } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, Card, colors, ListSkeleton, Screen, Text } from '~/components/ui';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { NewEntryScreen } from '~/features/entries/new-entry-screen';
import { useRecentTasks } from '~/features/home/use-recent-tasks';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { callEntryState, DEFAULT_CALL_MINUTES, parseCallLink } from './call-link';
import { isCallLoggingEnabled } from './call-settings';
import { matchClientByPhone } from './phone';

/** Funktionen er slået fra: forklar hvorfor og vis vejen til indstillingen. */
function DisabledNotice() {
  const router = useRouter();
  return (
    <Screen title={translate('calls.title')} back>
      <Card className="gap-3">
        <Text className="text-base text-foreground">{translate('calls.disabled_body')}</Text>
        <Button label={translate('calls.open_settings')} onPress={() => router.replace('/settings/calls')} testID="calls-open-settings" />
      </Card>
    </Screen>
  );
}

type MatchInfo = { minutes: number; clientName: string | null; hadPhone: boolean };

/** Kort over formularen: hvem opkaldet blev matchet med — nummeret vises kun her, lokalt. */
function CallIntro({ minutes, clientName, hadPhone }: MatchInfo) {
  const { theme } = useUniwind();
  let body = translate('calls.intro_no_phone', { minutes });
  if (clientName)
    body = translate('calls.intro_matched', { minutes, client: clientName });
  else if (hadPhone)
    body = translate('calls.intro_unknown', { minutes });
  return (
    <Card className="mb-4 flex-row items-center gap-3" testID="calls-intro">
      <PhoneCall size={20} color={colors.primary[theme === 'dark' ? 400 : 600]} />
      <View className="flex-1">
        <Text className="text-sm text-foreground">{body}</Text>
        <Text className="mt-1 text-xs text-muted-foreground">{translate('calls.privacy_hint')}</Text>
      </View>
    </Card>
  );
}

/** Henter kunder og seneste kunde, og viser først formularen når forvalget er kendt. */
function LogCallForm({ params }: { params: CallLinkParams }) {
  const link = React.useMemo(() => parseCallLink(params), [params]);
  const clients = trpc.clients.list.useQuery({});
  const recent = useRecentTasks();
  // Uden net er forespørgslerne pauset (isLoading = false), så formularen åbner
  // straks med det vi har; `key` nedenfor genstarter den når data når frem.
  const waiting = (clients.isLoading && !clients.isError) || (recent.isLoading && !recent.isError);
  // Skeletonen her lober, så en skærmlæser skal høre at den er færdig. Begge
  // kalde *meld* til skærmens stop — de har hver sin fejl, og `screenLoad`
  // regner en fejl som været sket først når ingen af dem leverede.
  useReportLoad(clients, translate('common.loaded'));
  useReportLoad(recent, translate('common.loaded'));

  if (waiting) {
    return (
      <Screen title={translate('calls.title')} back>
        <ListSkeleton rows={4} />
      </Screen>
    );
  }

  const matched = matchClientByPhone(clients.data ?? [], link.phone);
  const recentClientId = recent.quickStart?.clientId ?? null;
  const initialState = callEntryState({
    minutes: link.minutes,
    matchedClientId: matched?.id ?? null,
    recentClientId,
    description: translate('calls.default_description'),
  });
  return (
    <NewEntryScreen
      // Formularen læser kun start-state ved mount. Kommer kundelisten først
      // efter (fx efter offline), skal forvalget og kortet stadig passe sammen.
      key={`${matched?.id ?? '-'}:${recentClientId ?? '-'}`}
      initialState={initialState}
      title={translate('calls.title')}
      intro={<CallIntro minutes={link.minutes ?? DEFAULT_CALL_MINUTES} clientName={matched?.name ?? null} hadPhone={!!link.phone} />}
    />
  );
}

/**
 * `timetrack://log-opkald?minutter=12&telefon=...` — forudfyldt tidspost efter
 * et opkald. Intet sendes før brugeren trykker "Registrér", og telefonnummeret
 * indgår aldrig i den post der sendes.
 */
export function LogCallScreen() {
  const params = useLocalSearchParams<CallLinkParams>();
  const status = useAuthStore.use.status();
  const [enabled] = React.useState(isCallLoggingEnabled);

  if (status === 'signOut')
    return <Redirect href="/login" />;
  if (!enabled)
    return <DisabledNotice />;
  if (status === 'idle') {
    return (
      <Screen title={translate('calls.title')} back>
        <ListSkeleton rows={4} />
      </Screen>
    );
  }
  return (
    <ScreenLoad message={translate('common.loaded')}>
      <LogCallForm params={params} />
    </ScreenLoad>
  );
}
