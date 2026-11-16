import * as React from 'react';
import { Screen } from '~/components/ui/screen';
import { translate } from '~/lib/i18n';
import { AbsenceForm } from './absence-form';
import { EnterpriseGate } from './components/enterprise-gate';

/** Modal-rute: ny fraværsanmodning. */
export function AbsenceNewScreen() {
  return (
    <EnterpriseGate title={translate('enterprise.absence.new_title')} back>
      <Screen title={translate('enterprise.absence.new_title')} back scrollProps={{ keyboardShouldPersistTaps: 'handled' }}>
        <AbsenceForm />
      </Screen>
    </EnterpriseGate>
  );
}
