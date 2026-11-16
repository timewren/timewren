import type { LucideIcon } from 'lucide-react-native';
import { AlertTriangle } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import { translate } from '~/lib/i18n';
import colors from './colors';
import { Skeleton } from './skeleton';
import { Text } from './text';

export type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'violet';

type StatTileProps = {
  label: string;
  value: string;
  /** Lille tekst under værdien, fx "af 37 t" */
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  onPress?: () => void;
  /** Viser en Skeleton i stedet for værdien */
  loading?: boolean;
  /**
   * Værdien kunne ikke hentes. Uden den viser kortet et `0` for et kald der
   * fejlede — et tal der ligner rigtige data. Skjuler både værdi og hint, fordi
   * hinten kommer fra samme kald.
   */
  error?: boolean;
  className?: string;
  testID?: string;
  /** Samlet label. Uden den laves den af label, værdi og hint. */
  a11yLabel?: string;
};

const TONE_TEXT: Record<StatTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary-600 dark:text-primary-400',
  success: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
  danger: 'text-danger-600 dark:text-danger-400',
  violet: 'text-violet-600 dark:text-violet-300',
};

function toneColor(tone: StatTone, dark: boolean): string {
  switch (tone) {
    case 'primary': return colors.primary[dark ? 400 : 600];
    case 'success': return colors.success[dark ? 400 : 600];
    case 'warning': return colors.warning[dark ? 400 : 600];
    case 'danger': return colors.danger[dark ? 400 : 600];
    case 'violet': return colors.violet[dark ? 300 : 600];
    default: return dark ? colors.neutral[400] : colors.neutral[500];
  }
}

/** Nøgletal i et lille kort — til dashboards og overblik. Sæt 2 pr. række med `flex-1`. */
export function StatTile({ label, value, hint, icon: Icon, tone = 'default', onPress, loading = false, error = false, className = '', testID, a11yLabel }: StatTileProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const errorText = translate('common.error_value');
  const body = (
    <>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" numberOfLines={2}>{label}</Text>
        {Icon ? <Icon size={16} color={toneColor(error ? 'danger' : tone, dark)} /> : null}
      </View>
      {error
        ? (
            <View className="mt-1 flex-row items-center gap-1.5">
              <AlertTriangle size={14} color={toneColor('danger', dark)} />
              <Text className={twMerge('text-sm font-medium', TONE_TEXT.danger)}>{errorText}</Text>
            </View>
          )
        : loading
          ? <Skeleton className="mt-2 h-6 w-16" />
          /* Uden `numberOfLines` får beløb og timer to linjer i stedet for at blive
             skåret til "1.234…" ved en stor system-skriftstørrelse. Et afkortet
             beløb er et tal, brugeren ikke kan bruge. */
          : <Text className={twMerge('mt-1 text-2xl font-semibold tracking-tight', TONE_TEXT[tone])} style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>}
      {!error && hint ? <Text className="mt-0.5 text-xs text-muted-foreground">{hint}</Text> : null}
    </>
  );
  const cls = twMerge('flex-1 rounded-xl border border-border bg-card p-3', className);
  // Ét stop i stedet for tre: etiket, værdi og hint læses som én sætning
  const spoken = a11yLabel ?? [label, error ? errorText : loading ? null : value, error ? null : hint].filter(Boolean).join(', ');
  const a11y = spoken ? { accessible: true, accessibilityLabel: spoken } : {};
  const inner = (
    <View
      testID={testID ? `${testID}-indhold` : undefined}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {body}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} className={twMerge(cls, 'active:opacity-80')} accessibilityRole="button" testID={testID} {...a11y}>
        {inner}
      </Pressable>
    );
  }
  return <View className={cls} testID={testID} {...a11y}>{inner}</View>;
}
