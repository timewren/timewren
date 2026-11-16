import * as React from 'react';

import { cleanup, fireEvent, render, screen } from '~/lib/test-utils';

import { Text } from './text';

afterEach(cleanup);

describe('text', () => {
  it('gør en trykbar tekst til et link for skærmlæseren', () => {
    render(<Text onPress={() => {}} testID="tekst">Åbn kunden</Text>);
    const text = screen.getByTestId('tekst');
    expect(text).toHaveProp('accessibilityRole', 'link');
    expect(text).toHaveProp('accessible', true);
  });

  it('lader en tekst uden tryk være almindelig tekst', () => {
    render(<Text testID="tekst">Kunde Nord</Text>);
    const text = screen.getByTestId('tekst');
    expect(text.props.accessibilityRole).toBeUndefined();
    expect(text.props.accessible).toBeUndefined();
  });

  it('beholder en rolle, kalderen har sat selv', () => {
    render(<Text onPress={() => {}} accessibilityRole="button" testID="tekst">Åbn</Text>);
    expect(screen.getByTestId('tekst')).toHaveProp('accessibilityRole', 'button');
  });

  it('trykker stadig, når den er et link', () => {
    const onPress = jest.fn();
    render(<Text onPress={onPress} testID="tekst">Log ind</Text>);
    fireEvent.press(screen.getByTestId('tekst'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lader et tip gå med videre', () => {
    render(<Text onPress={() => {}} accessibilityHint="Skifter appen til uden konto-tilstand" testID="tekst">Fortsæt uden konto</Text>);
    expect(screen.getByTestId('tekst')).toHaveProp('accessibilityHint', 'Skifter appen til uden konto-tilstand');
  });
});
