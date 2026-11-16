import type { StartOptions } from '~/features/timer/use-timer';
import { History, Play } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Card, colors, EmptyState, ErrorState, ListRow, ListSkeleton, SectionHeader, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { useRecentTasks } from '../use-recent-tasks';

/** Seneste unikke opgaver (`time.getRecent`) med Start-knap der genstarter timeren med samme valg. */
type Props = {
  onStart: (opts: StartOptions) => void;
  /** Sandt når en timer allerede kører eller er i gang med at starte */
  disabled: boolean;
};

export function RecentCard({ onStart, disabled }: Props) {
  const { items, isLoading, isError, refetch } = useRecentTasks();

  useReportLoad({ isLoading, isError }, translate('common.loaded'));
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.primary[400] : colors.primary[600];

  return (
    <View>
      <SectionHeader title={translate('home.recent_title')} />
      {isLoading
        ? <ListSkeleton rows={2} />
        : isError
          ? <Card className="p-0"><ErrorState onRetry={refetch} /></Card>
          : items.length === 0
            ? (
                <Card className="p-0">
                  <EmptyState compact icon={History} title={translate('home.recent_empty')} />
                </Card>
              )
            : (
                <Card className="p-0">
                  {items.map((item, i) => (
                    <ListRow
                      key={item.entryId}
                      title={item.description || item.projectName || translate('timer.default_description')}
                      subtitle={[item.clientName, item.projectName].filter(Boolean).join(' · ') || undefined}
                      last={i === items.length - 1}
                      chevron={false}
                      testID={`recent-${item.entryId}`}
                      right={(
                        <Pressable
                          disabled={disabled}
                          onPress={() => onStart({
                            projectId: item.projectId,
                            clientId: item.clientId,
                            taskId: item.taskId,
                            description: item.description,
                            projectName: item.projectName,
                            clientName: item.clientName,
                          })}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={translate('timer.start')}
                          className={`flex-row items-center gap-1 rounded-full bg-primary-100 px-3 py-1.5 active:opacity-70 dark:bg-primary-900 ${disabled ? 'opacity-40' : ''}`}
                          testID={`recent-start-${item.entryId}`}
                        >
                          <Play size={14} color={tint} fill={tint} />
                          <Text className="text-sm font-semibold text-primary-700 dark:text-primary-200">{translate('timer.start')}</Text>
                        </Pressable>
                      )}
                    />
                  ))}
                </Card>
              )}
    </View>
  );
}
