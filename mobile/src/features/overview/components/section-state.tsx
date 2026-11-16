import * as React from 'react';
import { View } from 'react-native';
import { ErrorState, Skeleton } from '~/components/ui';
import { errorMessage } from '~/lib/api';

type Props = {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  /** Antal tile-pladsholdere pr. række under load (2 = to tiles) */
  tiles?: number;
  children: React.ReactNode;
};

/** Fælles load/fejl-håndtering for en overbliks-sektion. */
export function SectionState({ isLoading, isError, error, onRetry, tiles = 2, children }: Props) {
  if (isLoading)
    return <TileSkeleton count={tiles} />;
  if (isError)
    return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
  return <>{children}</>;
}

export function TileSkeleton({ count = 2 }: { count?: number }) {
  return (
    <View className="flex-row gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className="flex-1 rounded-2xl bg-card p-3 dark:border dark:border-border">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-7 w-20" />
        </View>
      ))}
    </View>
  );
}

/** To tiles side om side. */
export function TileRow({ children }: { children: React.ReactNode }) {
  return <View className="flex-row gap-3">{children}</View>;
}
