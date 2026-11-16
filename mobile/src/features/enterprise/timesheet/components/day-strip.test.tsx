import * as React from 'react';

import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { DayStrip } from './day-strip';

afterEach(cleanup);

const DAYS = ['2026-09-07', '2026-09-08'];

function totals(hours: number) {
  return { '2026-09-07': { work: hours, absence: 0, total: hours } };
}

describe('dayStrip', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('da');
  });

  it('læser timer og norm — ikke bare prikkens farve', () => {
    render(
      <DayStrip
        days={DAYS}
        selected="2026-09-07"
        today="2026-09-07"
        totals={totals(3)}
        norms={{ '2026-09-07': 7.5, '2026-09-08': 7.5 }}
        holidays={new Set<string>()}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('day-strip-2026-09-07')).toHaveProp(
      'accessibilityLabel',
      'Mandag 7. september, I dag, 3 t, af 7,5 t, under norm',
    );
    expect(screen.getByTestId('day-strip-2026-09-08')).toHaveProp(
      'accessibilityLabel',
      'Tirsdag 8. september, ingen registrerede timer, af 7,5 t, under norm',
    );
  });

  it('markerer den valgte dag som valgt', () => {
    render(
      <DayStrip
        days={DAYS}
        selected="2026-09-08"
        today="2026-09-07"
        totals={totals(7.5)}
        norms={{ '2026-09-07': 7.5, '2026-09-08': 7.5 }}
        holidays={new Set<string>()}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('day-strip-2026-09-07')).toHaveProp('accessibilityState', { selected: false });
    expect(screen.getByTestId('day-strip-2026-09-08')).toHaveProp('accessibilityState', { selected: true });
  });
});
