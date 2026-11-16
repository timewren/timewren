import type { BilledState } from '../bulk-select';
import * as React from 'react';
import { Button } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { BulkBar } from './bulk-bar';
import { Fab } from './fab';

type SelectToggleProps = {
  active: boolean;
  onPress: () => void;
};

/**
 * Headerens valg-knap. Kun dagsvisningen har den: uge- og månedsvisningen viser
 * dage, ikke poster, så der ville ikke være noget at vælge. Knappen sidder i
 * skærmens `right`, fordi den er en handling på hele skærmen — ikke endnu et
 * filter i den tætpakke af vælgere, skærmen allerede har.
 */
export function SelectToggle({ active, onPress }: SelectToggleProps) {
  return (
    <Button
      variant="ghost"
      label={translate(active ? 'entries.actions.cancel' : 'entries.bulk_pick')}
      onPress={onPress}
      testID="time-toggle-select"
    />
  );
}

type TimeFooterProps = {
  active: boolean;
  count: number;
  billedState: BilledState;
  busy: boolean;
  onMarkBilled: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRegister: () => void;
};

/**
 * Bundkanten: enten udvalgslinjen eller registrér-knappen — aldrig begge.
 *
 * De to låser hinanden, fordi de begge vil have bunden af skærmen: FAB'en over
 * udvalgslinjen ville skjule slet-knappen, og to trykflader oven på hinanden
 * er et dobbelttryk, man ikke har bedt om.
 */
export function TimeFooter({ active, count, billedState, busy, onMarkBilled, onDelete, onCancel, onRegister }: TimeFooterProps) {
  return active
    ? (
        <BulkBar
          count={count}
          billedState={billedState}
          busy={busy}
          onMarkBilled={onMarkBilled}
          onDelete={onDelete}
          onCancel={onCancel}
        />
      )
    : <Fab onPress={onRegister} label={translate('entries.register')} testID="time-fab" />;
}
