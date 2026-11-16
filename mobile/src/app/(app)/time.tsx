import * as React from 'react';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { TimesheetScreen } from '~/features/enterprise/timesheet/timesheet-screen';
import { TimeScreen } from '~/features/entries/time-screen';

/** Tid-fanen: enterprise-brugere arbejder i timesedlen, alle andre i registreringer. */
export default function TimeTab() {
  const caps = useCapabilities();
  if (caps.isEnterprise)
    return <TimesheetScreen />;
  return <TimeScreen />;
}
