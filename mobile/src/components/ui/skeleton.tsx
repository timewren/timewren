import * as React from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { twMerge } from 'tailwind-merge';
import { withUniwind } from 'uniwind';

const AnimatedView = withUniwind(Animated.View);

type SkeletonProps = {
  className?: string;
};

/** Pulserende pladsholder. Giv størrelse via className (h-4 w-32 osv.). */
export function Skeleton({ className = '' }: SkeletonProps) {
  const opacity = useSharedValue(0.5);
  React.useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <AnimatedView style={style} className={twMerge('rounded-md bg-muted', className)} />
  );
}

/** Tre kort-lignende rækker — standard-loading for lister. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="rounded-2xl bg-card p-4 dark:border dark:border-border">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </View>
      ))}
    </View>
  );
}
