import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Card } from '~/components/ui/card';
import colors from '~/components/ui/colors';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { errorMessage } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { AbsenceRequestRow } from './components/absence-request-row';
import { useMyRequests } from './use-absence';

/** Mine anmodninger, år for år. */
export function AbsenceRequests() {
  const router = useRouter();
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  const { mine, isLoading, isError, error, refetch } = useMyRequests(year);
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.neutral[100] : colors.neutral[900];

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable onPress={() => setYear(y => y - 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.previous_year')} className="size-11 items-center justify-center rounded-full active:bg-muted" testID="year-prev">
          <ChevronLeft size={22} color={tint} />
        </Pressable>
        <Text className="text-base font-semibold text-foreground">{year}</Text>
        <Pressable onPress={() => setYear(y => y + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={translate('common.next_year')} className="size-11 items-center justify-center rounded-full active:bg-muted" testID="year-next">
          <ChevronRight size={22} color={tint} />
        </Pressable>
      </View>
      {isLoading
        ? <ListSkeleton />
        : isError
          ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          : mine.length === 0
            ? (
                <EmptyState
                  icon={Inbox}
                  title={translate('enterprise.absence.empty_requests_title')}
                  description={translate('enterprise.absence.empty_requests_body')}
                  action={{ label: translate('enterprise.absence.request_button'), onPress: () => router.push('/enterprise/absence/new') }}
                  compact
                />
              )
            : (
                <Card className="p-0">
                  {mine.map((r, i) => (
                    <AbsenceRequestRow
                      key={r.id}
                      request={r}
                      onPress={() => router.push(`/enterprise/absence/${r.id}`)}
                      last={i === mine.length - 1}
                      testID={`request-${r.id}`}
                    />
                  ))}
                </Card>
              )}
    </View>
  );
}
