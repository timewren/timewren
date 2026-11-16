import * as React from 'react';
import { Text } from 'react-native';

import { cleanup, render, screen, setup } from '~/lib/test-utils';

import { Button } from './button';

afterEach(cleanup);

describe('button component ', () => {
  it('should render correctly ', () => {
    render(<Button testID="button" />);
    expect(screen.getByTestId('button')).toBeOnTheScreen();
  });
  it('should render correctly if we add explicit child ', () => {
    render(
      <Button testID="button">
        <Text> Custom child </Text>
      </Button>,
    );
    expect(screen.getByText('Custom child')).toBeOnTheScreen();
  });
  it('should render the label correctly', () => {
    render(<Button testID="button" label="Submit" />);
    expect(screen.getByTestId('button')).toBeOnTheScreen();
    expect(screen.getByText('Submit')).toBeOnTheScreen();
  });
  it('should render the loading indicator correctly', () => {
    render(<Button testID="button" loading={true} />);
    expect(screen.getByTestId('button')).toBeOnTheScreen();
    expect(screen.getByTestId('button-activity-indicator')).toBeOnTheScreen();
  });
  it('should call onClick handler when clicked', async () => {
    const onClick = jest.fn();
    const { user } = setup(
      <Button testID="button" label="Click the button" onPress={onClick} />,
    );
    expect(screen.getByTestId('button')).toBeOnTheScreen();
    await user.press(screen.getByTestId('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('should be disabled when loading', async () => {
    const onClick = jest.fn();
    const { user } = setup(
      <Button
        testID="button"
        loading={true}
        label="Click the button"
        onPress={onClick}
      />,
    );
    expect(screen.getByTestId('button')).toBeOnTheScreen();
    expect(screen.getByTestId('button-activity-indicator')).toBeOnTheScreen();
    expect(screen.getByTestId('button')).toBeDisabled();
    await user.press(screen.getByTestId('button'));
    expect(onClick).toHaveBeenCalledTimes(0);
  });
  it('should be disabled when disabled prop is true', () => {
    render(<Button testID="button" disabled={true} />);
    expect(screen.getByTestId('button')).toBeDisabled();
  });
  it('shouldn\'t call onClick when disabled', async () => {
    const onClick = jest.fn();
    const { user } = setup(
      <Button
        testID="button"
        label="Click the button"
        disabled={true}
        onPress={onClick}
        variant="secondary"
      />,
    );
    expect(screen.getByTestId('button')).toBeOnTheScreen();
    await user.press(screen.getByTestId('button'));

    expect(screen.getByTestId('button')).toBeDisabled();

    expect(onClick).toHaveBeenCalledTimes(0);
  });
  it('should apply correct styles based on size prop', () => {
    render(<Button testID="button" size="lg" />);
    const button = screen.getByTestId('button');
    // TODO: should be fixed to use haveStyle instead of comparing the class name
    const expectedStyle
      = 'font-inter font-medium text-white text-base';
    const receivedStyle
      = button.props.children[0].props.children.props.className;
    expect(receivedStyle).toContain(expectedStyle);
  });
  it('should apply correct styles for label when variant is secondary', () => {
    render(<Button testID="button" variant="secondary" label="Submit" />);
    const button = screen.getByTestId('button');

    const expectedStyle
      = 'font-inter font-medium text-white text-[15px]';
    const receivedStyle
      = button.props.children[0].props.children.props.className;
    expect(receivedStyle).toContain(expectedStyle);
  });
  it('should apply correct styles for label when is disabled', () => {
    render(<Button testID="button" label="Submit" disabled />);
    const button = screen.getByTestId('button');

    const expectedStyle
      = 'font-inter font-medium text-[15px] text-muted-foreground';
    const receivedStyle
      = button.props.children[0].props.children.props.className;
    expect(receivedStyle).toContain(expectedStyle);
  });
});

describe('button ved stor system-skrift', () => {
  // Jest kører med fontScale 2 (jest-expo's Dimensions-mock), altså den
  // indstilling hvor `h-11` klipper etiketten.
  it('gør plads til etiketten i stedet for at klippe den', () => {
    render(<Button testID="button" label="Gem ændringer" />);
    const button = screen.getByTestId('button');

    expect(button.props.style).toEqual({ minHeight: 70 });
    // 70 er højere end `h-11`, så Yoga bruger den — knappen kan ikke klippe.
    expect(button.props.style.minHeight).toBeGreaterThan(44);
  });

  it('gør aldrig en højere knap lavere', () => {
    render(<Button testID="button" label="Stop" className="h-14" />);
    const button = screen.getByTestId('button');

    // `minHeight` må kun vokse, så en kaldstørrelse-overstyring (h-14 = 56)
    // beholder sin højde i stedet for at blive klemt ned til grundhøjden.
    expect(button.props.className).toContain('h-14');
    expect(button.props.style.minHeight).toBeGreaterThanOrEqual(56);
  });

  it('skalerer en lille knap fra sin egen grundhøjde', () => {
    render(<Button testID="sm" size="sm" label="Gem" />);

    expect(screen.getByTestId('sm').props.style).toEqual({ minHeight: 51 });
  });

  it('skalerer en stor knap fra sin egen grundhøjde', () => {
    render(<Button testID="lg" size="lg" label="Gem" />);

    expect(screen.getByTestId('lg').props.style).toEqual({ minHeight: 77 });
  });

  it('lader en ikonknap være uden tekst, så den ikke vokser', () => {
    render(<Button testID="icon" size="icon" />);

    expect(screen.getByTestId('icon').props.style).toBeUndefined();
  });
});

describe('button a11y ', () => {
  it('should announce itself as a button with its label', () => {
    render(<Button testID="button" label="Gem ændringer" />);
    const button = screen.getByTestId('button');

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Gem ændringer');
    expect(button.props.accessibilityState.busy).toBe(false);
  });
  it('should let an explicit accessibilityLabel win over label', () => {
    render(
      <Button
        testID="button"
        label="Gem"
        accessibilityLabel="Gem ændringer på denne post"
      />,
    );
    expect(screen.getByTestId('button').props.accessibilityLabel).toBe(
      'Gem ændringer på denne post',
    );
  });
  it('should still be announced while loading', () => {
    render(<Button testID="button" label="Gemmer" loading />);
    const button = screen.getByTestId('button');

    // Spinneren erstatter teksten visuelt, så uden label læser VoiceOver intet.
    expect(screen.queryByText('Gemmer')).toBeNull();
    expect(button.props.accessibilityLabel).toBe('Gemmer');
    expect(button.props.accessibilityState.busy).toBe(true);
  });
});
