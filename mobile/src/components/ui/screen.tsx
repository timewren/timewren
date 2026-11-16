import type { ScrollViewProps } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useResolveClassNames, useUniwind } from 'uniwind';
import { translate } from '~/lib/i18n';
import colors from './colors';
import { FocusAwareStatusBar } from './focus-aware-status-bar';
import { SafeAreaView } from './safe-area';
import { Text } from './text';

export type ScreenProps = {
  title?: string;
  subtitle?: string;
  /** Vis tilbage-pil (til stack-skærme) */
  back?: boolean;
  /** Element(er) til højre i headeren, fx en IconButton */
  right?: React.ReactNode;
  /** Ekstra indhold under headeren, fx segment-kontrol */
  header?: React.ReactNode;
  /** Scroll (default) eller ren container når indholdet selv scroller (FlashList) */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
  contentContainerClassName?: string;
  /** Skjul header helt (skærmen tegner sin egen) */
  noHeader?: boolean;
  /** Ekstra ScrollView-props, fx keyboardShouldPersistTaps */
  scrollProps?: Omit<ScrollViewProps, 'refreshControl' | 'contentContainerClassName'>;
};

/**
 * Standard-skærm: safe area, statusbar, header med titel/tilbage/højre-handling,
 * valgfri pull-to-refresh. Alle fane- og stack-skærme bør bruge den.
 */
export function Screen(props: ScreenProps) {
  const {
    title,
    subtitle,
    back,
    right,
    header,
    scroll = true,
    refreshing = false,
    onRefresh,
    children,
    contentContainerClassName = 'px-4 pb-8',
    noHeader,
    scrollProps,
  } = props;
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.neutral[100] : colors.neutral[900];
  // KeyboardAwareScrollView (keyboard-controller) er tredjepart: className oversættes manuelt,
  // så felter i formularer scroller ind over tastaturet på begge platforme.
  const contentStyle = useResolveClassNames(contentContainerClassName);

  const headerNode = noHeader
    ? null
    : (
        <View className="w-full max-w-[760px] self-center px-4 pt-2 pb-3">
          <View className="min-h-11 flex-row items-center">
            {back ? <BackButton tint={tint} /> : null}
            <View className="flex-1">
              {title ? <Text accessibilityRole="header" className={back ? 'text-xl font-semibold text-foreground' : 'text-2xl font-semibold tracking-tight text-foreground'}>{title}</Text> : null}
              {subtitle ? <Text className="text-sm text-muted-foreground">{subtitle}</Text> : null}
            </View>
            {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
          </View>
          {header ? <View className="mt-3">{header}</View> : null}
        </View>
      );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'left', 'right']}>
      <FocusAwareStatusBar />
      {headerNode}
      {scroll
        ? (
            <KeyboardAwareScrollView
              contentContainerStyle={contentStyle}
              keyboardShouldPersistTaps="handled"
              bottomOffset={24}
              refreshControl={onRefresh
                ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tint} />
                : undefined}
              {...scrollProps}
            >
              <View className="w-full max-w-[760px] self-center">{children}</View>
            </KeyboardAwareScrollView>
          )
        : <View className="w-full max-w-[760px] flex-1 self-center">{children}</View>}
    </SafeAreaView>
  );
}

function BackButton({ tint }: { tint: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={translate('common.back')}
      className="mr-1 -ml-2 size-11 items-center justify-center rounded-full active:bg-muted"
      testID="screen-back"
    >
      <ChevronLeft color={tint} size={26} />
    </Pressable>
  );
}
