import { Alert, View } from 'react-native';
import { Badge, Button, Card, ErrorState, ListRow, ListSkeleton, Screen, SectionHeader, Text } from '~/components/ui';
import { brand } from '~/features/server/server-config';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { describeUserAgent } from './user-agent';

export function SecurityScreen() {
  return (
    <Screen title={translate('settings.security.title')} back>
      <SessionsSection />
      <TwoFactorSection />
      <PasskeysSection />
      <HistorySection />
    </Screen>
  );
}

function SessionsSection() {
  const utils = trpc.useUtils();
  const sessions = trpc.security.getSessions.useQuery();
  // Skærmens eneste skeleton-gate. TwoFactor, passkeys og login-historik har
  // ingen egen indlæsningstilstand, så de skal ikke høre hver sit stop.
  useAnnounceLoaded(sessions, translate('common.loaded'));
  const onDone = async () => {
    await utils.security.invalidate();
    showMessage({ message: translate('settings.security.revoked'), type: 'success' });
  };
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const revokeOne = trpc.security.revokeSession.useMutation({ onSuccess: onDone, onError });
  const revokeOthers = trpc.security.revokeAllOtherSessions.useMutation({ onSuccess: onDone, onError });
  const list = sessions.data ?? [];
  const others = list.filter(s => !s.isCurrent);

  const confirmRevokeOthers = () => {
    Alert.alert(translate('settings.security.revoke_others'), translate('settings.security.revoke_others_confirm'), [
      { text: translate('more.cancel'), style: 'cancel' },
      { text: translate('settings.security.revoke_others'), style: 'destructive', onPress: () => revokeOthers.mutate() },
    ]);
  };

  return (
    <View>
      <SectionHeader title={translate('settings.security.sessions')} className="mt-0" />
      {sessions.isLoading
        ? <ListSkeleton rows={2} />
        : sessions.isError
          ? <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
          : (
              <Card className="p-0">
                {list.map((s, i) => (
                  <ListRow
                    key={s.id}
                    title={describeUserAgent(s.userAgent, translate('settings.security.unknown_device'), brand.name)}
                    subtitle={[s.ipAddress, `${formatDateShort(s.createdAt)} ${formatTime(s.createdAt)}`].filter(Boolean).join(' · ')}
                    right={s.isCurrent
                      ? <Badge label={translate('settings.security.current')} tone="primary" />
                      : (
                          <Button
                            label={translate('settings.security.revoke')}
                            variant="outline"
                            size="sm"
                            fullWidth={false}
                            loading={revokeOne.isPending && revokeOne.variables?.sessionId === s.id}
                            onPress={() => revokeOne.mutate({ sessionId: s.id })}
                          />
                        )}
                    last={i === list.length - 1}
                  />
                ))}
              </Card>
            )}
      {others.length > 0
        ? (
            <Button
              className="mt-3"
              variant="destructive"
              label={translate('settings.security.revoke_others')}
              loading={revokeOthers.isPending}
              onPress={confirmRevokeOthers}
              testID="revoke-others"
            />
          )
        : null}
    </View>
  );
}

function TwoFactorSection() {
  const status = trpc.security.getTwoFactorStatus.useQuery();
  const on = status.data?.enabled === true;
  return (
    <View>
      <SectionHeader title={translate('settings.security.two_factor')} />
      {/* Uden egen fejlgren sagde et kald, der fejlede, "Slået fra / OFF" — en
          sikkerhedsoplysning de ikke har. Samme form som sessionerne ovenfor. */}
      {status.isLoading
        ? <Card className="p-0"><ListSkeleton rows={1} /></Card>
        : status.isError
          ? <ErrorState message={errorMessage(status.error)} onRetry={() => void status.refetch()} />
          : (
              <Card className="p-0">
                <ListRow
                  title={translate(on ? 'settings.security.two_factor_on' : 'settings.security.two_factor_off')}
                  subtitle={translate('settings.security.manage_on_web')}
                  right={<Badge label={on ? 'ON' : 'OFF'} tone={on ? 'success' : 'default'} />}
                  last
                />
              </Card>
            )}
    </View>
  );
}

function PasskeysSection() {
  const passkeys = trpc.security.getPasskeys.useQuery();
  const list = passkeys.data ?? [];
  return (
    <View>
      <SectionHeader title={translate('settings.security.passkeys')} />
      <Card className="p-0">
        {list.length === 0
          ? <Text className="px-4 py-3 text-sm text-muted-foreground">{translate('settings.security.passkeys_empty')}</Text>
          : list.map((p, i) => (
              <ListRow key={p.id} title={p.name} subtitle={formatDateShort(p.createdAt)} last={i === list.length - 1} />
            ))}
      </Card>
    </View>
  );
}

function HistorySection() {
  const history = trpc.security.getLoginHistory.useQuery({ limit: 10 });
  const list = history.data ?? [];
  // Kaldet skal *svare* "ingen logninger", før sektionen forsvinder. Uden
  // denne skeln viste et fejlet kald brugeren en skærm uden login-historik —
  // altså uden det svar, hen holdet kom for at se.
  if (!history.isError && list.length === 0)
    return null;
  return (
    <View>
      <SectionHeader title={translate('settings.security.login_history')} />
      <Card className="p-0">
        {history.isError
          ? <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
          : list.map((s, i) => (
              <ListRow
                key={s.id}
                title={describeUserAgent(s.userAgent, translate('settings.security.unknown_device'), brand.name)}
                subtitle={`${formatDateShort(s.createdAt)} ${formatTime(s.createdAt)}${s.ipAddress ? ` · ${s.ipAddress}` : ''}`}
                right={<Badge label={translate(s.isActive ? 'settings.security.active' : 'settings.security.expired')} tone={s.isActive ? 'success' : 'default'} />}
                last={i === list.length - 1}
              />
            ))}
      </Card>
    </View>
  );
}
