import { ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import colors from './colors';
import { Text } from './text';

type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Højre side: tekst (fx "2,5 t") eller eget element */
  right?: React.ReactNode;
  /** Venstre element, fx Avatar eller farveprik. Skjules altid for skærmlæseren. */
  left?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  className?: string;
  testID?: string;
  /** Sidste række i en gruppe: ingen bundkant */
  last?: boolean;
  /**
   * Samlet label for skærmlæseren. Uden den laves den af titel, undertitel og
   * højre tekst, så rækken læses som ét. Sæt den selv, når højre side er et
   * element, du vil have læst sammen med rækken.
   */
  a11yLabel?: string;
  /**
   * Markering for skærmlæseren, fx `{ selected: true }` i en udvalgstilstand.
   * Rækken læses stadig ét stop, så `selected` forteller skærmlæseren hvad
   * trykket gør — det er ikke noget `a11yLabel` kan sige.
   */
  a11yState?: { selected?: boolean };
};

/**
 * Række til lister og indstillinger. Sæt dem i et `Card` med `p-0` for grupperet look.
 *
 * Rækken læses som ét stop: titel, undertitel og højre tekst bliver én label,
 * og børnene skjules for skærmlæseren. Er `right` et element (fx en knap eller
 * et badge med egen betydning) og der er ingen `a11yLabel`, grupperer vi ikke —
 * ellers ville indholdet blive ulæseligt. `left` er derimod altid kun et
 * billede af titlen (avatar, farveprik, ikon), så det skjules altid: ellers
 * læses avatarens navn to gange, lige før titlen siger det samme.
 */
export function ListRow(props: ListRowProps) {
  const { title, subtitle, right, left, onPress, onLongPress, chevron, className = '', testID, last, a11yLabel, a11yState } = props;
  const { theme } = useUniwind();
  const label = a11yLabel ?? (right == null || typeof right === 'string'
    ? [title, subtitle, typeof right === 'string' ? right : null]
        .filter((part): part is string => Boolean(part))
        .join(', ')
    : null);
  const content = (
    <View
      testID={testID ? `${testID}-indhold` : undefined}
      className={twMerge('min-h-14 flex-row items-center gap-3 px-4 py-3', last ? '' : 'border-b border-border', className)}
      {...(label ? { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true } : {})}
    >
      {left
        ? (
            <View
              testID={testID ? `${testID}-venstre` : undefined}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {left}
            </View>
          )
        : null}
      <View className="flex-1">
        <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {typeof right === 'string'
        ? <Text className="text-[15px] font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{right}</Text>
        : right}
      {chevron ?? onPress
        ? <ChevronRight size={16} color={theme === 'dark' ? colors.neutral[500] : colors.neutral[400]} />
        : null}
    </View>
  );
  const a11y = label ? { accessible: true, accessibilityLabel: label } : {};
  if (!onPress && !onLongPress)
    return <View testID={testID} {...a11y} accessibilityState={a11yState}>{content}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="active:bg-muted" accessibilityRole="button" testID={testID} {...a11y} accessibilityState={a11yState}>
      {content}
    </Pressable>
  );
}

/** Lille farvet prik, fx kundefarve. */
export function ColorDot({ color, size = 10 }: { color?: string | null; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color || colors.neutral[400] }}
    />
  );
}
