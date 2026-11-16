import type { LucideIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { translate } from '~/lib/i18n';
import { Button } from './button';
import colors from './colors';
import { Text } from './text';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; testID?: string };
  compact?: boolean;
};

/** Tom tilstand der fortæller hvad brugeren kan gøre — aldrig bare "Ingen data". Linear-stil: roligt ikon, lille tekst. */
export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  const { theme } = useUniwind();
  return (
    <View className={compact ? 'items-center rounded-xl border border-dashed border-border px-6 py-8' : 'flex-1 items-center justify-center px-8 py-16'}>
      {Icon ? <Icon size={28} strokeWidth={1.5} color={theme === 'dark' ? colors.neutral[600] : colors.neutral[300]} /> : null}
      <Text className={Icon ? 'mt-3 text-center text-sm font-medium text-foreground' : 'text-center text-sm font-medium text-foreground'}>{title}</Text>
      {description ? <Text className="mt-1 text-center text-[13px] text-muted-foreground">{description}</Text> : null}
      {action
        ? (
            <Button
              className="mt-4"
              size="sm"
              fullWidth={false}
              label={action.label}
              onPress={action.onPress}
              testID={action.testID}
            />
          )
        : null}
    </View>
  );
}

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
};

/** Fejltilstand med "Prøv igen" — brug `onRetry={refetch}` på alle skærme der henter data. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <EmptyState
      title={translate('common.error_generic')}
      description={message ?? translate('common.error_load')}
      action={onRetry ? { label: translate('common.retry'), onPress: onRetry, testID: 'retry' } : undefined}
      compact
    />
  );
}
