import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { intlDateLocale } from '~/lib/locale';

export function OfflineReadNotice({ savedAt }: { savedAt?: number }) {
  useTranslation();
  const updated = savedAt === undefined
    ? undefined
    : new Intl.DateTimeFormat(intlDateLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(savedAt);
  return (
    <View className="my-2 rounded-xl bg-warning-100 px-3 py-2 dark:bg-warning-900">
      {updated === undefined
        ? <Text className="text-sm text-warning-700 dark:text-warning-200" tx="offline.read_unavailable" />
        : <Text className="text-sm text-warning-700 dark:text-warning-200">{translate('offline.read_saved', { updated })}</Text>}
    </View>
  );
}
