import * as React from 'react';

import { cleanup, render, screen } from '~/lib/test-utils';

import { Avatar } from './avatar';
import { Badge } from './badge';
import { ListRow } from './list-row';

afterEach(cleanup);

describe('listRow', () => {
  it('læser titel, undertitel og højre tekst som ét stop', () => {
    render(<ListRow title="Kunde Nord" subtitle="Aalborg" right="2,5 t" testID="row" />);
    expect(screen.getByTestId('row')).toHaveProp('accessibilityLabel', 'Kunde Nord, Aalborg, 2,5 t');
    expect(screen.getByTestId('row-indhold', { includeHiddenElements: true })).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  });

  it('springer tomme dele over i label', () => {
    render(<ListRow title="Kunde Nord" testID="row" />);
    expect(screen.getByTestId('row')).toHaveProp('accessibilityLabel', 'Kunde Nord');
  });

  it('gør en trykbar række til én knap', () => {
    render(<ListRow title="Kunde Nord" right="2,5 t" onPress={() => {}} testID="row" />);
    const row = screen.getByTestId('row');
    expect(row).toHaveProp('accessibilityRole', 'button');
    expect(row).toHaveProp('accessible', true);
    expect(row).toHaveProp('accessibilityLabel', 'Kunde Nord, 2,5 t');
  });

  it('sluger ikke et element i højre side, der har egen betydning', () => {
    render(
      <ListRow
        title="Ferie"
        right={<ListRow title="Godkendt" testID="badge" />}
        onPress={() => {}}
        testID="row"
      />,
    );
    // Uden egen label ville badge'en blive ulæselig for skærmlæseren
    expect(screen.getByTestId('row')).not.toHaveProp('accessibilityLabel');
    expect(screen.getByLabelText('Godkendt')).toBeOnTheScreen();
  });

  it('accepterer en samlet label, når højre side er et element', () => {
    render(
      <ListRow title="Ferie" a11yLabel="Ferie, ferieuge, 1. – 5. juli" right={<ListRow title="Godkendt" testID="badge" />} testID="row" />,
    );
    expect(screen.getByTestId('row')).toHaveProp('accessibilityLabel', 'Ferie, ferieuge, 1. – 5. juli');
  });

  it('giver en række med venstre element stadig ét stop', () => {
    render(<ListRow title="Mads Holm" left={<ListRow title="avatar" testID="avatar" />} testID="row" />);
    expect(screen.getByTestId('row')).toHaveProp('accessibilityLabel', 'Mads Holm');
  });

  it('skjuler venstre element, så avatarens navn ikke læses to gange', () => {
    // Rækken grupperer ikke (højre side er et badge), så uden skjulning ville
    // avataren være sit eget stop med præcis det navn, titlen siger.
    render(
      <ListRow
        title="Mads Holm"
        subtitle="mads@x.dk"
        left={<Avatar name="Mads Holm" />}
        right={<Badge label="Ejer" />}
        testID="row"
      />,
    );
    const left = screen.getByTestId('row-venstre', { includeHiddenElements: true });
    expect(left).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(left).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.getByTestId('row')).not.toHaveProp('accessibilityLabel');
    expect(screen.getByText('Ejer')).toBeOnTheScreen();
  });
});
