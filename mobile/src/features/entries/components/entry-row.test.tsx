import type { TimeEntry } from '../use-entries';
import * as React from 'react';
import { cleanup, render, screen } from '~/lib/test-utils';
import { EntryRow } from './entry-row';

/**
 * Faktureringsstatus er den eneste forskel på rækken, der forteller brugeren
 * at tiden allerede er skrevet på en faktura. `is_billed` er nullable i web's
 * schema, så kun `true` må give badgen — `null` er det samme som ikke
 * faktureret (jf. `matchesBilled`).
 */

jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

function post(overrides: Partial<TimeEntry> = {}) {
  return {
    id: 'e1',
    description: 'Support',
    hours: '2',
    date: new Date(2026, 9, 1),
    isBillable: true,
    isBilled: false,
    isPrepaid: false,
    ...overrides,
  } as unknown as TimeEntry;
}

afterEach(cleanup);

describe('entryRow', () => {
  it('viser «Faktureret» på en post der står på en faktura', () => {
    render(<EntryRow entry={post({ isBilled: true })} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.getByText('entries.billed_badge')).toBeOnTheScreen();
  });

  it('viser ingen badge på en post uden faktura', () => {
    render(<EntryRow entry={post()} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.queryByText('entries.billed_badge')).toBeNull();
  });

  it('tæller en post uden værdi som ikke-faktureret', () => {
    // `undefined`/`null` må ikke give badgen: serveren sætter kolonnen eksplicit,
    // så en gammel post uden værdi er netop ikke-faktureret.
    render(<EntryRow entry={post({ isBilled: null })} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.queryByText('entries.billed_badge')).toBeNull();
  });

  it('skjuler ikke badgen for skærmlæseren', () => {
    // Rækken grupperer kun, når højre side er tekst. Her er den et element med
    // egen betydning, så `ListRow` lader børnene være — ellers ville
    // «Faktureret» aldrig blive læst op.
    render(<EntryRow entry={post({ isBilled: true })} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.getByTestId('entry-e1-indhold')).not.toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.getByText('entries.billed_badge')).toBeOnTheScreen();
  });

  it('markerer rækken i udvalgstilstand', () => {
    // Uden `selected` siger skærmlæseren ikke, om trykket åbner posten eller
    // markerer den — to forskellige handlinger på det samme tryk.
    render(<EntryRow entry={post()} onPress={jest.fn()} onLongPress={jest.fn()} selected={false} />);
    expect(screen.getByTestId('entry-e1')).toHaveProp('accessibilityState', { selected: false });
  });

  it('lader skærmlæseren høre en markeret post', () => {
    render(<EntryRow entry={post()} onPress={jest.fn()} onLongPress={jest.fn()} selected />);
    expect(screen.getByTestId('entry-e1')).toHaveProp('accessibilityState', { selected: true });
  });

  it('siger intet om markering uden for udvalgstilstand', () => {
    // Ellers hænger `selected: false` ved på enhver række, også dem hvor trykket
    // åbner posten — hvilket er en påstand om en handling der ikke findes.
    render(<EntryRow entry={post()} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.getByTestId('entry-e1').props.accessibilityState.selected).toBeUndefined();
  });

  it('lader skærmlæseren læse rækken som sit eget stop', () => {
    // Uden egen label grupperer `ListRow` ikke: højre side er et element, så
    // titel, undertekst og badge læses hver for sig — som de skal.
    render(<EntryRow entry={post()} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.getByTestId('entry-e1')).not.toHaveProp('accessibilityLabel');
    expect(screen.getByText('2 t')).toBeOnTheScreen();
  });
});
