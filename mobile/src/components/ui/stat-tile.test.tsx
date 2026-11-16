import * as React from 'react';

import { translate } from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';

import { Avatar } from './avatar';
import { StatTile } from './stat-tile';

afterEach(cleanup);

describe('avatar', () => {
  it('læser navnet i stedet for initialerne', () => {
    render(<Avatar name="Mads Holst Jensen" />);
    const avatar = screen.getByLabelText('Mads Holst Jensen');
    expect(avatar).toHaveProp('accessibilityRole', 'image');
  });

  it('læser navnet på billedvarianten', () => {
    render(<Avatar name="Mads Holst Jensen" image="https://example.com/mads.jpg" />);
    expect(screen.getByLabelText('Mads Holst Jensen')).toBeOnTheScreen();
  });

  it('lader et navnløst avatar være stille', () => {
    render(<Avatar name={null} />);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });
});

describe('statTile', () => {
  it('læser etiket, værdi og hint som ét stop', () => {
    render(<StatTile label="Fakturerbare timer" value="12,5 t" hint="58 % af tiden" testID="tile" />);
    expect(screen.getByTestId('tile')).toHaveProp('accessibilityLabel', 'Fakturerbare timer, 12,5 t, 58 % af tiden');
    expect(screen.getByTestId('tile-indhold', { includeHiddenElements: true })).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  });

  it('springer værdien over, mens den indlæser', () => {
    render(<StatTile label="I dag" value="0 t" loading testID="tile" />);
    expect(screen.getByTestId('tile')).toHaveProp('accessibilityLabel', 'I dag');
  });

  it('gør en trykbar flade til én knap', () => {
    render(<StatTile label="Omsætning" value="12.345 kr." onPress={() => {}} testID="tile" />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveProp('accessibilityRole', 'button');
    expect(tile).toHaveProp('accessibilityLabel', 'Omsætning, 12.345 kr.');
  });
});

describe('statTile med en fejltilstand', () => {
  // Teksten kommer fra `translate`, så testen ikke binder sig til et sprog.
  const fejl = () => translate('common.error_value');
  // Kortets indhold er skjult for skærmlæseren (`no-hide-descendants`), så
  // opslagene skal med vilje læse skjult indhold — ellers ville de være grønne
  // fordi de slet intet så.
  const skjult = (tekst: string) => screen.queryByText(tekst, { includeHiddenElements: true });

  it('siger at tallet ikke kom, i stedet for at vise nullen', () => {
    render(<StatTile label="Flexsaldo" value="0,0 t" error testID="tile" />);
    expect(screen.getByTestId('tile')).toHaveProp('accessibilityLabel', `Flexsaldo, ${fejl()}`);
    expect(skjult('0,0 t')).toBeNull();
    expect(screen.getByText(fejl(), { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('skjuler også hinten, fordi den kommer fra samme fejlede kald', () => {
    render(<StatTile label="Ufaktureret" value="0,00 kr." hint="3,5 t · 2 fakturaer" error testID="tile" />);
    expect(skjult('3,5 t · 2 fakturaer')).toBeNull();
    expect(screen.getByTestId('tile')).toHaveProp('accessibilityLabel', `Ufaktureret, ${fejl()}`);
  });

  it('viger for indlæsning, men siger aldrig "indlæst" for en fejl', () => {
    // React Query sætter `isLoading` false når kaldet fejler, så de to kan
    // ikke stå begge. Skulle det ske, skal fejlen stadig være det der vises.
    render(<StatTile label="Flexsaldo" value="0,0 t" loading error testID="tile" />);
    expect(screen.getByText(fejl(), { includeHiddenElements: true })).toBeOnTheScreen();
    expect(skjult('0,0 t')).toBeNull();
  });

  it('beholder et a11yLabel, når kalderen har lavet sit eget', () => {
    render(<StatTile label="Flexsaldo" value="0,0 t" error a11yLabel="Flexsaldo, ikke hentet" testID="tile" />);
    expect(screen.getByTestId('tile')).toHaveProp('accessibilityLabel', 'Flexsaldo, ikke hentet');
  });
});
