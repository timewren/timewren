import { useRouter } from 'expo-router';
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { colors, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { announce } from '~/lib/notify';
import { failedCount, pendingCount } from '../queue-logic';
import { useOfflineQueue } from '../queue-store';

/**
 * Lille statuslinje øverst på Hjem og Tid: offline / ventende sync / fejlede.
 * Skjult når alt er synkroniseret og der er net. Tryk → kø-oversigten.
 */
export function OfflineBanner({ className = '' }: { className?: string }) {
  const router = useRouter();
  const items = useOfflineQueue.use.items();
  const isOnline = useOfflineQueue.use.isOnline();
  const isSyncing = useOfflineQueue.use.isSyncing();
  const pending = pendingCount(items);
  const failed = failedCount(items);
  const hidden = isOnline && pending === 0 && failed === 0;
  const tone = failed > 0 ? 'danger' : isOnline ? 'primary' : 'warning';
  const message = failed > 0
    ? translate('offline.banner_failed', { count: failed })
    : isOnline
      ? (isSyncing ? translate('offline.banner_syncing') : translate('offline.banner_pending', { count: pending }))
      : pending > 0
        ? translate('offline.banner_offline_pending', { count: pending })
        : translate('offline.banner_offline');
  useAnnounceChange(hidden ? null : tone, message);

  if (hidden)
    return null;

  const Icon = failed > 0 ? TriangleAlert : isOnline ? RefreshCw : CloudOff;

  const bg = { danger: 'bg-danger-100 dark:bg-danger-900', primary: 'bg-primary-100 dark:bg-primary-900', warning: 'bg-warning-100 dark:bg-warning-900' }[tone];
  const fg = { danger: 'text-danger-700 dark:text-danger-200', primary: 'text-primary-700 dark:text-primary-200', warning: 'text-warning-700 dark:text-warning-200' }[tone];
  const iconColor = { danger: colors.danger[600], primary: colors.primary[600], warning: colors.warning[600] }[tone];

  return (
    <Pressable
      onPress={() => router.push('/settings/offline')}
      accessibilityRole="button"
      accessibilityLabel={message}
      accessibilityHint={translate('offline.banner_hint')}
      testID="offline-banner"
      className={twMerge('mb-3 flex-row items-center gap-2 rounded-xl px-3 py-2', bg, className)}
    >
      <Icon size={16} color={iconColor} />
      <View className="flex-1">
        <Text className={twMerge('text-sm font-medium', fg)} numberOfLines={2}>{message}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Skærmlæseren hører, når forbindelsen ryger, eller noget fejler — banneret
 * dukkede før op i stilhed. Kun ved skift af tilstand, ikke ved hver ny post.
 * Via `announce` (én mekanisme, se `~/lib/notify`), ikke en live region.
 */
function useAnnounceChange(tone: string | null, message: string) {
  const previousToneRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // Ny tekst i samme tilstand (fx et tal mere) annonceres ikke.
    if (tone !== null && tone !== previousToneRef.current)
      announce(message);
    previousToneRef.current = tone;
  }, [tone, message]);
}
