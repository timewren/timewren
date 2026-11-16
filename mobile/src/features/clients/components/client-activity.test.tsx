import type { ActivityInvoice, ActivityStats } from '../client-activity-logic';
import { subDays } from 'date-fns';
import * as React from 'react';
import { toISODate } from '~/lib/format';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { ClientActivity } from './client-activity';

/**
 * `ListRow` pakker titel og højre tekst i ét label med
 * `accessibilityElementsHidden`, fordi rækken er ét stop. RNTL springer
 * skjulte elementer over ved opslag, så UDEN dette ville alle taltjek være
 * grønne fordi de intet fandt.
 */
const SKJULT = { includeHiddenElements: true } as const;

function mockRouter() {
  return { push: jest.fn() };
}
jest.mock('expo-router', () => ({ useRouter: mockRouter }));

beforeEach(async () => {
  // Enhedens sprog i testen er en, men brugeren læser dansk
  await i18n.changeLanguage('da');
});

afterEach(cleanup);

/** Serverens `max(timeEntries.date)` — UTC-midnat på den valgte dag. */
function serverDate(d: Date): string {
  return `${toISODate(d)}T00:00:00.000Z`;
}

function inv(partial: Partial<ActivityInvoice> & { id: string }): ActivityInvoice {
  return { status: 'sent', amount: 0, createdAt: '2026-09-01T09:00:00.000Z', dueDate: null, ...partial };
}

function renderActivity(stats: ActivityStats, invoices: ActivityInvoice[] = []) {
  return render(
    <ClientActivity
      stats={stats}
      invoices={invoices}
      isLoading={false}
      isError={false}
      onRetry={jest.fn()}
      statsFailed={false}
    />,
  );
}

/** Rækkens samlede label — den er det skærmlæseren faktisk læser. */
function labelOf(testID: string): string {
  return String(screen.getByTestId(testID).props.accessibilityLabel ?? '');
}

/**
 * `lastActivityDate` er `max(timeEntries.date)` — en **dato**-kolonne, som
 * `time.create` skriver som UTC-midnat på den valgte dag. `formatAgo` ville
 * læse den som et klokkeslæt: en post lavet kl. 11 vises «for 13 timer siden»,
 * en post fra i går aftens «for 2 dage siden», og en post med fremtidig dato
 * får en negativ alder.
 */
describe('senest registreret tid', () => {
  it('viser «I dag» for en post fra i dag, ikke et klokkeslæt', () => {
    renderActivity({ lastActivityDate: serverDate(new Date()), overdueCount: 0 });

    expect(screen.getByText('I dag', SKJULT)).toBeTruthy();
    expect(screen.queryByText(/siden/, SKJULT)).toBeNull();
  });

  it('viser «I går» for en post fra i går', () => {
    renderActivity({ lastActivityDate: serverDate(subDays(new Date(), 1)), overdueCount: 0 });

    expect(screen.getByText('I går', SKJULT)).toBeTruthy();
  });

  it('viser datoen for en post fra i sidste uge', () => {
    renderActivity({ lastActivityDate: serverDate(subDays(new Date(), 7)), overdueCount: 0 });

    expect(labelOf('client-activity-last-time')).not.toMatch(/I dag|siden/);
    expect(labelOf('client-activity-last-time')).toMatch(/\d+\. \w+\.?/);
  });

  it('viser aldrig en negativ alder for en post med fremtidig dato', () => {
    renderActivity({ lastActivityDate: serverDate(subDays(new Date(), -5)), overdueCount: 0 });

    expect(labelOf('client-activity-last-time')).not.toMatch(/siden/);
  });
});

/**
 * Kortet må ikke fortælle to sandheder om den samme kunde i samme
 * skærmbillede. Badgen på «Seneste faktura» bruger `effectiveStatus` (en sendt
 * faktura med overskredet forfaldsdato er forfalden), mens linjen «Forfalde
 * fakturaer» fik serverens `overdueCount`/`overdueAmount` — der kun tæller
 * status `overdue`, altså dem cron'en kl. 06:15 har flyttet. Kl. 09.00 viste
 * kortet «Forfalden» på 1.500 kr. og «Ingen forfaldne» på linjen under.
 */
describe('forfalde fakturaer', () => {
  const FORFALDET = serverDate(subDays(new Date(), 2));

  it('tæller en sendt faktura med overskredet forfaldsdato, selv om serveren ikke har gjort det', () => {
    renderActivity(
      { lastActivityDate: null, overdueCount: 0, overdueAmount: '0.00' },
      [inv({ id: 'a', invoiceNumber: '1042', dueDate: FORFALDET, amount: '1500.00' })],
    );

    expect(screen.getByText(i18n.t('invoices.status.overdue'), SKJULT)).toBeTruthy();
    expect(screen.queryByText(i18n.t('clients.no_overdue'), SKJULT)).toBeNull();
    expect(screen.getByText('1 · 1.500 kr.', SKJULT)).toBeTruthy();
  });

  it('tæller ikke den samme faktura to gange, når serveren allerede har gjort det', () => {
    renderActivity(
      { lastActivityDate: null, overdueCount: 1, overdueAmount: '1500.00' },
      [inv({ id: 'a', invoiceNumber: '1042', status: 'overdue', dueDate: FORFALDET, amount: '1500.00' })],
    );

    expect(screen.getByText('1 · 1.500 kr.', SKJULT)).toBeTruthy();
  });

  it('lader en betalt faktura være ude, selv om forfaldsdatoen er passeret', () => {
    renderActivity(
      { lastActivityDate: null, overdueCount: 0, overdueAmount: '0.00' },
      [inv({ id: 'a', status: 'paid', dueDate: FORFALDET, amount: '1500.00' })],
    );

    expect(screen.getByText(i18n.t('clients.no_overdue'), SKJULT)).toBeTruthy();
  });
});
