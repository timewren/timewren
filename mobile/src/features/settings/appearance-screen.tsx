import type { OptionType } from '~/components/ui';
import type { ColorSchemeType } from '~/lib/hooks/use-selected-theme';
import type { Language } from '~/lib/i18n/resources';
import i18n from 'i18next';
import * as React from 'react';
import { View } from 'react-native';
import { Card, ListRow, Options, Screen, SectionHeader, useModal } from '~/components/ui';
import { useSelectedTheme } from '~/lib/hooks/use-selected-theme';
import { translate, useSelectedLanguage } from '~/lib/i18n';

/** Tema (system/lys/mørk) og sprog (da/en). Sprogskift genstarter appen — det gør i18n-laget selv. */
export function AppearanceScreen() {
  return (
    <Screen title={translate('settings.appearance.title')} back>
      <SectionHeader title={translate('settings.appearance.theme')} className="mt-0" />
      <Card className="p-0">
        <ThemeRow />
      </Card>
      <SectionHeader title={translate('settings.appearance.language')} />
      <Card className="p-0">
        <LanguageRow />
      </Card>
    </Screen>
  );
}

function ThemeRow() {
  const { selectedTheme, setSelectedTheme } = useSelectedTheme();
  const modal = useModal();
  const options = React.useMemo<OptionType[]>(
    () => [
      { label: translate('settings.appearance.theme_system'), value: 'system' },
      { label: translate('settings.appearance.theme_light'), value: 'light' },
      { label: translate('settings.appearance.theme_dark'), value: 'dark' },
    ],
    [],
  );
  const current = options.find(o => o.value === selectedTheme);
  const onSelect = React.useCallback((option: OptionType) => {
    setSelectedTheme(option.value as ColorSchemeType);
    modal.dismiss();
  }, [setSelectedTheme, modal]);

  return (
    <View>
      <ListRow title={translate('settings.appearance.theme')} right={current?.label} onPress={modal.present} last testID="theme-row" />
      <Options ref={modal.ref} options={options} onSelect={onSelect} value={selectedTheme} />
    </View>
  );
}

function LanguageRow() {
  const { language, setLanguage } = useSelectedLanguage();
  const modal = useModal();
  const options = React.useMemo<OptionType[]>(
    () => [
      { label: translate('settings.appearance.danish'), value: 'da' },
      { label: translate('settings.appearance.english'), value: 'en' },
      { label: translate('settings.appearance.german'), value: 'de' },
      { label: translate('settings.appearance.spanish'), value: 'es' },
    ],
    [],
  );
  const current = options.find(o => o.value === language) ?? options.find(o => o.value === i18n.language);
  const onSelect = React.useCallback((option: OptionType) => {
    modal.dismiss();
    setLanguage(option.value as Language);
  }, [setLanguage, modal]);

  return (
    <View>
      <ListRow title={translate('settings.appearance.language')} right={current?.label} onPress={modal.present} last testID="language-row" />
      <Options ref={modal.ref} options={options} onSelect={onSelect} value={current?.value} />
    </View>
  );
}
