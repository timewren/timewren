import Env from 'env';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { Newspaper } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorState, ListRow, ListSkeleton, Screen, SectionHeader, Text } from '~/components/ui';
import { PRIVACY_URL, TERMS_URL, WEBSITE_URL } from '~/features/more/links';
import { ServerSelector } from '~/features/server/server-selector';
import { trpc } from '~/lib/api';
import { formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { teaser } from './teaser';

function open(url: string) {
  void WebBrowser.openBrowserAsync(url);
}

export function AboutScreen() {
  const changelog = trpc.changelog.getAll.useQuery();
  useAnnounceLoaded(changelog, translate('common.loaded'));
  const build = Application.nativeBuildVersion ?? '–';
  const news = (changelog.data ?? []).slice(0, 10);

  return (
    <Screen title={translate('settings.about.title')} back>
      <ServerSelector />
      <Card className="p-0">
        <ListRow title={translate('settings.about.version')} right={Env.EXPO_PUBLIC_VERSION} />
        <ListRow title={translate('settings.about.build')} right={build} last />
      </Card>
      <SectionHeader title={translate('settings.about.changelog')} />
      {changelog.isLoading
        ? <ListSkeleton rows={2} />
        : changelog.isError
          ? <ErrorState onRetry={changelog.refetch} />
          : news.length === 0
            ? <EmptyState icon={Newspaper} title={translate('settings.about.changelog_empty')} compact />
            : (
                <Card className="gap-4">
                  {news.map(entry => (
                    <View key={entry.id}>
                      <View className="flex-row items-baseline justify-between">
                        <Text className="flex-1 font-semibold text-foreground" numberOfLines={1}>{entry.title}</Text>
                        <Text className="ml-2 text-xs text-muted-foreground">{`v${entry.version} · ${formatDateShort(entry.publishedAt)}`}</Text>
                      </View>
                      <Text className="mt-0.5 text-sm text-muted-foreground">{teaser(entry.content)}</Text>
                    </View>
                  ))}
                </Card>
              )}
      <SectionHeader title={translate('common.links')} />
      <Card className="p-0">
        <ListRow title={translate('settings.about.privacy')} onPress={() => open(PRIVACY_URL)} testID="about-privacy" />
        <ListRow title={translate('settings.about.terms')} onPress={() => open(TERMS_URL)} />
        <ListRow title={translate('settings.about.website')} onPress={() => open(WEBSITE_URL)} last />
      </Card>
    </Screen>
  );
}
