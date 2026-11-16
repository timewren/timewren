import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { Shareable, ShareConfig, ShareLink, SharePeriod } from '../report-share-logic';
import { Link2, Send, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Share as RNShare, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button } from '~/components/ui/button';
import { Card, SectionHeader } from '~/components/ui/card';
import { Switch } from '~/components/ui/checkbox';
import colors from '~/components/ui/colors';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { IconButton } from '~/components/ui/icon-button';
import { Input } from '~/components/ui/input';
import { ListRow } from '~/components/ui/list-row';
import { Modal } from '~/components/ui/modal';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceVisible } from '~/lib/notify';
import { canCreateLink, defaultShareName, linkSubtitle, shareMessage, trimmedShareName } from '../report-share-logic';
import { CREATING, useShareLink } from '../use-share-link';

type Props = {
  ref: React.RefObject<BottomSheetModal | null>;
  /** Serverens egen periode fra `getReportData` — aldrig en lokal nyberegning. */
  period: SharePeriod | undefined;
  /** Samme config som rapporten viser, så linket viser præcis den rapport. */
  config: ShareConfig | null;
  /**
   * Listen hentes **kun når arket er åbent**. `BottomSheetModal` monterer sit
   * indhold hele tiden, så uden dette sprang skærmen et kald for hvert besøg
   * på Rapporter — for en liste brugeren måske aldrig ser.
   */
  enabled: boolean;
  /** Kaldes når arket lukkes, så læskermen kan holde op med at hente listen. */
  onDismiss?: () => void;
};

/**
 * Del en tidsrapport som et læse-link.
 *
 * Serverens `createShareLink` gemmer config'en og et randomiseret token, og den
 * offentlige side `/r/<token>` læser den uden login. Vi deler derfor **kun** det
 * link serveren selv returnerer — aldrig en URL vi sætter sammen, fordi vores
 * egen base-URL ikke nødvendigvis er den samme som web'ens `getAppUrl()`.
 */
export function ShareReportSheet({ ref, period, config, enabled, onDismiss }: Props) {
  const links = trpc.reports.listShareLinks.useQuery(undefined, { enabled });
  const { createLink, revokeLink, busyId } = useShareLink();
  // Navnet følger den periode rapporten viser, men kun indtil brugeren rører feltet.
  const [name, setName] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [lockDates, setLockDates] = React.useState(true);
  const { theme } = useUniwind();

  const shownName = touched || !period ? name : (name || defaultShareName(period));
  useAnnounceVisible(links, translate('common.loaded'));

  const shareUrl = React.useCallback(async (link: Shareable) => {
    const message = shareMessage(link);
    if (message)
      await RNShare.share({ message });
  }, []);

  // Opret, del og kvitter er ét kald i `createLink` — låden ligger dér, så to
  // tryk hverken laver to links eller åbner to share-ark.
  const submit = React.useCallback(() => {
    if (!config)
      return;
    void createLink({ config, name: trimmedShareName(shownName), lockDates });
  }, [config, createLink, lockDates, shownName]);

  const confirmRevoke = React.useCallback((link: ShareLink) => {
    Alert.alert(
      translate('reports.share.delete'),
      translate('reports.share.revoke_confirm', { name: link.name }),
      [
        { text: translate('common.cancel'), style: 'cancel' },
        {
          text: translate('reports.share.delete'),
          style: 'destructive',
          onPress: () => {
            void revokeLink(link.id);
          },
        },
      ],
    );
  }, [revokeLink]);

  return (
    <Modal
      ref={ref}
      snapPoints={['75%']}
      title={translate('reports.share.title')}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: theme === 'dark' ? colors.neutral[900] : colors.white }}
    >
      <View className="px-4 pb-8">
        <Text className="mb-3 text-sm text-muted-foreground" tx="reports.share.body" />
        <Input
          label={translate('reports.share.name')}
          placeholder={translate('reports.share.name_placeholder')}
          value={shownName}
          onChangeText={(text) => {
            setTouched(true);
            setName(text);
          }}
          maxLength={120}
          testID="share-name"
        />
        <Switch
          checked={lockDates}
          onChange={setLockDates}
          label={translate('reports.share.lock_dates')}
          accessibilityLabel={translate('reports.share.lock_dates')}
          accessibilityHint={translate('reports.share.lock_dates_hint')}
          className="mb-1"
          testID="share-lock-dates"
        />
        <Text className="mb-3 text-xs text-muted-foreground" tx="reports.share.lock_dates_hint" />
        <Button
          label={translate('reports.share.create')}
          loading={busyId === CREATING}
          disabled={!config || !canCreateLink(shownName)}
          onPress={submit}
          testID="share-create"
        />
        <ExistingLinks links={links} busyId={busyId} onShare={shareUrl} onRevoke={confirmRevoke} />
      </View>
    </Modal>
  );
}

type LinkState = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  data?: ShareLink[];
};

/** De aktive links: samme liste som web's dialog, med synlige handlinger pr. række. */
function ExistingLinks({ links, busyId, onShare, onRevoke }: {
  links: LinkState;
  /** Hvilket link der er ved at blive tilbagekaldt — `CREATING` gælder ikke her. */
  busyId: string | null;
  onShare: (link: Shareable) => Promise<void>;
  onRevoke: (link: ShareLink) => void;
}) {
  if (links.isLoading)
    return <ListSkeleton rows={2} />;
  if (links.isError)
    return <ErrorState message={errorMessage(links.error)} onRetry={() => links.refetch()} />;
  const rows = links.data ?? [];
  return (
    <>
      <SectionHeader title={translate('reports.share.links_title')} />
      {rows.length === 0
        ? (
            <EmptyState
              icon={Link2}
              title={translate('reports.share.empty_title')}
              description={translate('reports.share.empty_body')}
              compact
            />
          )
        : (
            <Card className="p-0">
              {rows.map((link, index) => (
                <ListRow
                  key={link.id}
                  title={link.name}
                  subtitle={linkSubtitle(link)}
                  last={index === rows.length - 1}
                  testID={`share-link-${link.id}`}
                  right={(
                    <View className="flex-row items-center">
                      {/* URL'en findes kun lige efter oprettelsen (hashet token) */}
                      {link.url
                        ? (
                            <IconButton
                              icon={Send}
                              label={translate('reports.share.share_again')}
                              onPress={() => {
                                void onShare(link);
                              }}
                              testID={`share-send-${link.id}`}
                            />
                          )
                        : null}
                      <IconButton
                        icon={Trash2}
                        label={translate('reports.share.delete')}
                        onPress={() => onRevoke(link)}
                        disabled={busyId === link.id}
                        testID={`share-revoke-${link.id}`}
                      />
                    </View>
                  )}
                />
              ))}
            </Card>
          )}
    </>
  );
}
