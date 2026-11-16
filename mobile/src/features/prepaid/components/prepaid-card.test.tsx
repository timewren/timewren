import type { PrepaidCardItem } from './prepaid-card';

import * as React from 'react';
import i18n from '~/lib/i18n';

import { cleanup, render, screen } from '~/lib/test-utils';
import { PrepaidCard } from './prepaid-card';

afterEach(cleanup);

const NOW = new Date('2026-10-20T10:00:00');

const PKG: PrepaidCardItem = {
  id: 'p1',
  name: 'Acme Support',
  totalHours: 30,
  remainingHours: 12.5,
  expiryDate: '2026-11-14T00:00:00',
  hourlyRate: 750,
  client: { name: 'Nord' },
};

function spokenLabel(pkg: PrepaidCardItem = PKG) {
  render(<PrepaidCard pkg={pkg} onPress={() => {}} />);
  return String(screen.getByTestId(`prepaid-card-${pkg.id}`).props.accessibilityLabel);
}

describe('prepaidCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    // Enhedens sprog i testen er en, men brugeren læser dansk
    void i18n.changeLanguage('da');
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('læser navn, kunde, saldo, pris og udløb som ét stop', () => {
    const label = spokenLabel({ ...PKG, expiryDate: '2027-01-14T00:00:00' });
    // 12,5 t × 750 kr. — beløbet står på kortet, så det skal høres med
    expect(label).toContain('Acme Support');
    expect(label).toContain('Nord');
    expect(label).toContain('12,5');
    expect(label).toContain('9.375 kr.');
    // Badge'en og labelen skal sige præcis det samme om udløbet
    const badge = screen.getByText(/Udløber/, { includeHiddenElements: true });
    expect(label).toContain(badge.props.children);
  });

  it('siger Udløbet, når datoen er passeret', () => {
    const label = spokenLabel({ ...PKG, expiryDate: '2026-10-01T00:00:00' });
    expect(label).toContain(screen.getByText('Udløbet', { includeHiddenElements: true }).props.children);
  });

  it('udløbsdatoen læses fra den badge, der vises', () => {
    const label = spokenLabel({ ...PKG, expiryDate: '2026-10-22T00:00:00' });
    expect(label).toContain(screen.getByText('2 dage tilbage', { includeHiddenElements: true }).props.children);
  });

  it('springer pris fra, når den er skjult', () => {
    const label = spokenLabel({ ...PKG, hideValue: true });
    expect(label).not.toContain('kr.');
  });

  it('siger opbrugt, når saldoen er brugt', () => {
    const label = spokenLabel({ ...PKG, remainingHours: 0 });
    expect(label).toContain('Opbrugt');
  });
});
