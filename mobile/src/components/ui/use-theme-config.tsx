import type { Theme } from '@react-navigation/native';
import {
  DarkTheme as _DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import { useUniwind } from 'uniwind';

import colors from '~/components/ui/colors';

/** Mørkt react-navigation-tema — samme tokens som `bg-background`/`bg-card` i global.css. */
const DarkTheme: Theme = {
  ..._DarkTheme,
  colors: {
    ..._DarkTheme.colors,
    primary: colors.primary[400],
    background: colors.theme.dark.background,
    card: colors.theme.dark.card,
    text: colors.theme.dark.foreground,
    border: colors.theme.dark.border,
    notification: colors.danger[500],
  },
};

const LightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary[600],
    background: colors.theme.light.background,
    card: colors.theme.light.card,
    text: colors.theme.light.foreground,
    border: colors.theme.light.border,
    notification: colors.danger[600],
  },
};

export function useThemeConfig() {
  const { theme } = useUniwind();

  if (theme === 'dark')
    return DarkTheme;

  return LightTheme;
}
