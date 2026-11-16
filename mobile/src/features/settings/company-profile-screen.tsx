import type { CompanyForm, CompanyType, VatPeriod } from './company-profile';
import type { RouterOutputs } from '~/api/app-router';
import { Building2 } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Input, ListSkeleton, Screen, Select, Switch, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { COMPANY_TYPES, formFromProfile, isCompanyFormDirty, parseFiscalYearEnd, toCompanyInput, VAT_PERIODS } from './company-profile';

type Profile = NonNullable<RouterOutputs['user']['getProfile']>;

/**
 * Virksomhedsprofilen driver `user.getUpcomingDeadlines` (moms, A-skat,
 * årsrapport). Uden den viser Oversigt en besked om at gå ind på web —
 * så den låses her i appen i stedet.
 */
export function CompanyProfileScreen() {
  const query = trpc.user.getProfile.useQuery();
  const caps = useCapabilities();
  useAnnounceLoaded(query, translate('common.loaded'));

  return (
    <Screen title={translate('settings.company.title')} back>
      {query.isLoading
        ? <ListSkeleton rows={2} />
        : query.isError || !query.data
          ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
          : caps.hasOrg && !caps.isAdmin
            ? (
                <EmptyState
                  icon={Building2}
                  title={translate('settings.company.no_permission_title')}
                  description={translate('settings.company.no_permission_body')}
                  compact
                />
              )
            : <CompanyProfileForm profile={query.data} />}
    </Screen>
  );
}

function CompanyProfileForm({ profile }: { profile: Profile }) {
  const utils = trpc.useUtils();
  const initial = React.useMemo(() => formFromProfile(profile), [profile]);
  const [form, setForm] = React.useState<CompanyForm>(initial);

  const update = trpc.user.updateCompanyInfo.useMutation({
    onSuccess: async () => {
      // `getUpcomingDeadlines` læser den gemte profil, så profil-routeren skal
      // genhentes, ellers står fristerne med den gamle kodetekst.
      await utils.user.invalidate();
      showMessage({ message: translate('settings.company.saved'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  const set = React.useCallback(<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const parsed = parseFiscalYearEnd(form.fiscalYearEnd);
  const dirty = isCompanyFormDirty(initial, form);

  const save = () => {
    if (!parsed.ok) {
      showMessage({ message: translate(`settings.company.error_${parsed.error}`), type: 'danger' });
      return;
    }
    update.mutate(toCompanyInput(form, parsed.value));
  };

  const typeOptions = React.useMemo(
    () => [{ label: translate('settings.company.unset'), value: NONE } as Option, ...COMPANY_TYPES.map(v => ({ label: translate(`settings.company.type_${v}`), value: v } as Option))],
    [],
  );
  const vatOptions = React.useMemo(
    () => [{ label: translate('settings.company.unset'), value: NONE } as Option, ...VAT_PERIODS.map(v => ({ label: translate(`settings.company.vat_${v}`), value: v } as Option))],
    [],
  );

  return (
    <View className="gap-4">
      <Card className="gap-4">
        <Select
          label={translate('settings.company.type')}
          options={typeOptions}
          value={form.companyType ?? NONE}
          onSelect={v => set('companyType', v === NONE ? null : (v as CompanyType))}
          placeholder={translate('settings.company.unset')}
          testID="company-type"
        />
        <Select
          label={translate('settings.company.vat')}
          options={vatOptions}
          value={form.vatPeriod ?? NONE}
          onSelect={v => set('vatPeriod', v === NONE ? null : (v as VatPeriod))}
          placeholder={translate('settings.company.unset')}
          testID="company-vat"
        />
        <Input
          label={translate('settings.company.fiscal_year_end')}
          value={form.fiscalYearEnd}
          onChangeText={v => set('fiscalYearEnd', v)}
          placeholder="12-31"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          error={!parsed.ok ? translate(`settings.company.error_${parsed.error}`) : undefined}
          testID="company-fye"
        />
        <Switch
          checked={form.hasEmployees}
          onChange={v => set('hasEmployees', v)}
          label={translate('settings.company.has_employees')}
          accessibilityLabel={translate('settings.company.has_employees')}
          testID="company-employees"
        />
        <Text className="text-xs text-muted-foreground">{translate('settings.company.hint')}</Text>
      </Card>
      <Button
        label={translate('settings.company.save')}
        onPress={save}
        disabled={!dirty || update.isPending}
        loading={update.isPending}
        testID="company-save"
      />
    </View>
  );
}

const NONE = '__none__';
type Option = { label: string; value: CompanyType | VatPeriod | typeof NONE };
