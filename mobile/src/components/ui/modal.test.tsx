import type { View } from 'react-native';
import { useRef } from 'react';
import { AccessibilityInfo, Pressable, ScrollView } from 'react-native';
import { translate } from '~/lib/i18n';
import { act, fireEvent, render, screen, within } from '~/lib/test-utils';
import { AccessibleSheetProvider, Modal, useModal } from './modal';

const mockDismiss = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { Portal, PortalProvider } = jest.requireActual('@gorhom/portal');
  function OpenSheet({ children, onChange, onDismiss }: any) {
    const callbacksRef = React.useRef({ onChange, onDismiss });
    React.useEffect(() => {
      const callbacks = callbacksRef.current;
      callbacks.onChange(0, 0, 0);
      return () => callbacks.onDismiss();
    }, []);
    return children;
  }
  return {
    ...jest.requireActual('@gorhom/bottom-sheet/mock'),
    BottomSheetModalProvider: PortalProvider,
    BottomSheetModal: ({ ref, handleComponent: Handle, containerComponent: Container, children, onChange, onDismiss }: any) => {
      const [open, setOpen] = React.useState(false);
      React.useImperativeHandle(ref, () => ({
        present: () => setOpen(true),
        dismiss: () => {
          mockDismiss();
          setOpen(false);
        },
      }));
      return open && (
        <Portal name="test-sheet">
          <Container>
            <OpenSheet onChange={onChange} onDismiss={onDismiss}>
              <Handle />
              {children}
            </OpenSheet>
          </Container>
        </Portal>
      );
    },
  };
});

function Harness({ scrollable, title = 'Tidspost' }: { scrollable?: boolean; title?: string }) {
  const modal = useModal();
  const triggerRef = useRef<View>(null);
  return (
    <AccessibleSheetProvider>
      <Pressable ref={triggerRef} accessibilityRole="button" accessibilityLabel="Åbn" onPress={() => modal.presentFrom(() => triggerRef.current)} />
      <Modal ref={modal.ref} onDismiss={modal.restoreFocus} title={title} scrollable={scrollable}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Redigér"
          onPress={() => {
            modal.clearReturnFocus();
            modal.dismiss();
          }}
        />
      </Modal>
    </AccessibleSheetProvider>
  );
}

beforeEach(() => {
  mockDismiss.mockClear();
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('exposes a named heading and a separate close button with a 48-unit target', () => {
  const title = 'Configuración de las opciones de facturación del proyecto';
  render(<Harness title={title} />);
  fireEvent.press(screen.getByRole('button', { name: 'Åbn' }));
  expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  const close = screen.getByRole('button', { name: translate('common.close') });
  expect(close).toHaveStyle({ minHeight: 48, minWidth: 48 });
  fireEvent.press(close);
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it('keeps the full title and actions in the same scroll view', () => {
  const title = 'Configuración de las opciones de facturación del proyecto '.repeat(9).trim();
  render(<Harness title={title} scrollable />);
  fireEvent.press(screen.getByRole('button', { name: 'Åbn' }));
  const content = within(screen.UNSAFE_getByType(ScrollView));
  expect(content.getByRole('header', { name: title })).toBeOnTheScreen();
  expect(content.getByRole('button', { name: 'Redigér' })).toBeOnTheScreen();
});

it('focuses the heading, hides the background and restores the opening control on close', () => {
  const focus = AccessibilityInfo.sendAccessibilityEvent;
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Åbn' });
  fireEvent.press(trigger);
  expect(screen.queryByRole('button', { name: 'Åbn' })).toBeNull();
  expect(screen.getByRole('header', { name: 'Tidspost' })).toBeOnTheScreen();
  expect(focus).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ accessibilityLabel: 'Tidspost' }) }), 'focus');

  fireEvent.press(screen.getByRole('button', { name: translate('common.close') }));
  act(() => jest.runOnlyPendingTimers());
  expect(screen.getByRole('button', { name: 'Åbn' })).toBeOnTheScreen();
  expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ accessibilityLabel: 'Åbn' }) }), 'focus');
});

it('can skip restoring focus when a sheet action takes the user to another screen', () => {
  const focus = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
  render(<Harness />);
  fireEvent.press(screen.getByRole('button', { name: 'Åbn' }));
  focus.mockClear();
  fireEvent.press(screen.getByRole('button', { name: 'Redigér' }));
  act(() => jest.runOnlyPendingTimers());
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
});
