import type * as ReactNative from 'react-native';
import * as React from 'react';
import { StatTile } from '~/components/ui/stat-tile';
import { translate } from '~/lib/i18n';
import { cleanup, render, screen, within } from '~/lib/test-utils';
import { InvoicesScreen } from './invoices-screen';

const mockPaidDate = new Date(2026, 10, 18, 12);

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('~/components/ui/list', () => ({
  List: ({ ListHeaderComponent }: { ListHeaderComponent: React.ReactNode }) => ListHeaderComponent,
}));
jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({ isEnabled: () => true }),
}));
jest.mock('~/lib/api', () => ({
  trpc: {
    invoices: {
      list: {
        useQuery: () => ({
          data: [
            { id: '1', status: 'overdue', amount: '1234567.89', dueDate: null },
            { id: '2', status: 'paid', amount: '2345678.90', dueDate: null, paidDate: mockPaidDate },
          ],
        }),
      },
      getStats: { useQuery: () => ({ data: { totalPending: 3456789.12 } }) },
    },
  },
}));
jest.mock('./components/invoice-row', () => ({ InvoiceRow: () => null }));
jest.mock('./from-time-sheet', () => ({ FromTimeSheet: () => null }));

const stats = [
  ['invoices.stats.outstanding', '3.456.789,12 kr.'],
  ['invoices.stats.overdue', '1.234.567,89 kr.'],
  ['invoices.stats.paid_month', '2.345.678,90 kr.'],
] as const;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(mockPaidDate);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  { width: 440, fontScale: 1, twoColumns: true },
  { width: 320, fontScale: 1, twoColumns: false },
  { width: 440, fontScale: 1.5, twoColumns: false },
])('viser fakturanøgletal ved bredde $width og tekstskalering $fontScale', ({ width, fontScale, twoColumns }) => {
  jest.spyOn(jest.requireActual<typeof ReactNative>('react-native'), 'useWindowDimensions').mockReturnValue({ width, height: 956, scale: 3, fontScale });
  render(<InvoicesScreen />);

  stats.forEach(([key, amount]) => {
    const label = translate(key);
    const tile = screen.getByLabelText(`${label}, ${amount}`);
    const content = within(tile);
    for (const text of [label, amount]) {
      const node = content.getByText(text, { includeHiddenElements: true });
      expect(node.props.numberOfLines === 1).toBe(fontScale <= 1);
      expect(node).toHaveProp('adjustsFontSizeToFit', fontScale <= 1);
    }
  });

  const [outstanding, overdue, paid] = screen.UNSAFE_getAllByType(StatTile);
  expect(outstanding.parent === overdue.parent).toBe(true);
  expect(paid.parent === outstanding.parent).toBe(false);
  expect(outstanding.parent?.props.className.split(' ').includes('flex-row')).toBe(twoColumns);
});
