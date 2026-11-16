import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { ProjectStats } from './project-stats';

/** Skjult indhold skal stadig kunne læses — se `client-stats.test.tsx`. */
const SKJULT = { includeHiddenElements: true } as const;

// 40.000 kr. til 850 kr./t = 47,1 t budget, så 12,5 t er 27 %
const PROJEKT = { id: 'p1', name: 'Rungsted', fixedPrice: '40000', hourlyRate: '850' } as unknown as React.ComponentProps<typeof ProjectStats>['project'];

const TAL = { totalHours: 12.5, revenue: 10_625, entriesCount: 4 } as unknown as React.ComponentProps<typeof ProjectStats>['stats'];

/**
 * `BalanceBar` sætter `accessibilityRole="progressbar"`, men RNTL's
 * `queryByRole` kortlægger ikke den role i dette setup. Træet tælles derfor i
 * `toJSON`, som kun rummer de native elementer — så en talt bjælke er en
 * bjælke, ikke to (komponent + element).
 */
function bjælker() {
  return JSON.stringify(screen.toJSON()).split('"accessibilityRole":"progressbar"').length - 1;
}

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

afterEach(cleanup);

function renderStats(props: Partial<React.ComponentProps<typeof ProjectStats>> = {}) {
  render(<ProjectStats project={PROJEKT} stats={TAL} monthly={undefined} isLoading={false} {...props} />);
}

describe('nøgletallene på projektet', () => {
  it('viser de rigtige tal, når kallet svarer', () => {
    renderStats();

    expect(screen.getByText('12,5 t', SKJULT)).toBeTruthy();
    expect(screen.getByText('10.625 kr.', SKJULT)).toBeTruthy();
    expect(screen.getByText('4', SKJULT)).toBeTruthy();
    // Budgetkortet regner procenten ud fra de timer, kallet svarede
    expect(screen.getByText('27 %', SKJULT)).toBeTruthy();
  });

  /**
   * Her løj ikke bare tallene: budgetkortet regner procenten ud fra
   * `stats?.totalHours ?? 0`, så mens kallet var i gang stod der "0 % brugt" i
   * grøn tone og en tom bjælke under. Et budget der ser sundt ud, fordi tallene
   * ikke er kommet endnu, er værre end et tal der mangler — en leder kan nå at
   * konkludere at projektet har budget, inden tallene er hentet.
   */
  it('viser ingen procent og ingen bjælke, mens kallet er i gang', () => {
    renderStats({ stats: undefined, isLoading: true });

    expect(screen.queryByText('12,5 t', SKJULT)).toBeNull();
    expect(screen.queryByText('10.625 kr.', SKJULT)).toBeNull();
    expect(screen.queryByText('0 %', SKJULT)).toBeNull();
    expect(screen.queryByLabelText(/0 %/, SKJULT)).toBeNull();
    expect(bjælker()).toBe(0);
  });

  it('tegner bjælken, når der er timer at tegne den fra', () => {
    renderStats();

    expect(bjælker()).toBe(1);
  });
});
