import type { ErrorBoundaryProps } from 'expo-router';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { use, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import colors from '~/components/ui/colors';
import { resources } from '~/lib/i18n/resources';
import { captureError } from '~/lib/monitoring';

const reportedErrors = new WeakSet<Error>();

export function RootErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const language = i18n.resolvedLanguage ?? getLocales()[0]?.languageCode ?? 'da';
  const copy = (Object.hasOwn(resources, language) ? resources[language as keyof typeof resources] : resources.da)
    .translation
    .common;
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? colors.theme.dark : colors.theme.light;
  const insets = use(SafeAreaInsetsContext);

  useEffect(() => {
    // React can receive a thrown primitive despite Expo Router's Error type.
    if (typeof error === 'object' && error !== null) {
      if (reportedErrors.has(error))
        return;
      reportedErrors.add(error);
    }
    captureError(error);
  }, [error]);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: (insets?.top ?? 0) + 24,
          paddingBottom: (insets?.bottom ?? 0) + 24,
          paddingLeft: (insets?.left ?? 0) + 24,
          paddingRight: (insets?.right ?? 0) + 24,
        },
      ]}
    >
      <Text accessibilityRole="alert" style={[styles.message, { color: theme.foreground }]}>
        {copy.root_error}
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>{copy.retry}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.primary[600],
    borderRadius: 8,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
