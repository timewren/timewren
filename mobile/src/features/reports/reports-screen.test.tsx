import type { ReportConfig } from './report-logic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Share } from 'react-native';
import { Button } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { act, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { ReportsScreen } from './reports-screen';

const mockExport = jest.fn();
const mockReport = jest.fn();
const mockToast = jest.fn();
const csv = { format: 'csv', data: 'date,hours\n2026-11-01,2' };
const currentPeriod = { start: '2026-11-01', end: '2026-11-30' };
const previousPeriod = { start: '2026-10-01', end: '2026-10-31' };

jest.mock('~/lib/api', () => ({
  errorMessage: (error: Error) => error.message,
  trpc: {
    reports: {
      getReportData: { useQuery: (input: { config: ReportConfig }) => mockReport(input) },
      exportReport: {
        useMutation: (options: object) => jest.requireActual('@tanstack/react-query').useMutation({
          ...options,
          mutationFn: (input: unknown) => mockExport(input),
        }),
      },
    },
  },
}));

jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({ isEnabled: () => true }),
}));
jest.mock('./components/share-report-sheet', () => ({ ShareReportSheet: () => null }));
jest.mock('~/lib/notify', () => ({
  showMessage: (...args: unknown[]) => mockToast(...args),
  useAnnounceLoaded: jest.fn(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

function renderReports() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } })}>
      <ReportsScreen />
    </QueryClientProvider>,
  );
}

function csvButton() {
  return screen.getByTestId('reports-share-csv');
}

beforeEach(() => {
  mockExport.mockReset().mockResolvedValue(csv);
  mockToast.mockReset();
  mockReport.mockReset().mockImplementation(({ config }: { config: ReportConfig }) => ({
    data: {
      period: config.filters?.dateRange === 'lastMonth' ? previousPeriod : currentPeriod,
      entries: [{ hours: '2', _rounded: 2, _value: 0 }],
      aggregates: { summary: { totalHours: 2, totalRevenue: 0, unbilledRevenue: 0 } },
    },
  }));
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each([
  ['iOS-annullering', Share.dismissedAction],
  ['Androids resultat uden annulleringsstatus', Share.sharedAction],
])('viser ingen fejl ved %s og tillader et nyt forsøg', async (_, action) => {
  jest.mocked(Share.share).mockResolvedValueOnce({ action });
  renderReports();

  fireEvent.press(csvButton());
  await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(csvButton()).toBeEnabled());
  expect(mockToast).not.toHaveBeenCalled();

  fireEvent.press(csvButton());
  await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(2));
});

it('viser en lokaliseret fejl ved en native afvisning og tillader et nyt forsøg', async () => {
  jest.mocked(Share.share).mockRejectedValueOnce(new Error('Native share failure'));
  renderReports();

  fireEvent.press(csvButton());
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({
    message: translate('reports.csv_share_error'),
    type: 'danger',
  }));
  expect(mockToast).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(csvButton()).toBeEnabled());

  fireEvent.press(csvButton());
  await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(2));
});

it('viser serverfejlen uden at åbne delingsarket', async () => {
  mockExport.mockRejectedValueOnce(new Error('Serverfejl'));
  renderReports();

  fireEvent.press(csvButton());
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ message: 'Serverfejl', type: 'danger' }));
  expect(Share.share).not.toHaveBeenCalled();
});

it('låser dobbelttryk før genrender og deler med perioden fra eksportstart', async () => {
  let finishExport!: (result: typeof csv) => void;
  mockExport.mockReturnValueOnce(new Promise((resolve) => {
    finishExport = resolve;
  }));
  let finishShare!: (result: Awaited<ReturnType<typeof Share.share>>) => void;
  jest.mocked(Share.share).mockReturnValueOnce(new Promise((resolve) => {
    finishShare = resolve;
  }));
  renderReports();
  const displayedInput = mockReport.mock.lastCall[0];

  const press = screen.UNSAFE_getAllByType(Button).find(button => button.props.testID === 'reports-share-csv')!.props.onPress;
  act(() => {
    press();
    press();
  });
  fireEvent.press(screen.getByTestId('reports-period-lastMonth'));
  expect(mockReport.mock.lastCall[0].config.filters.dateRange).toBe('lastMonth');
  await waitFor(() => expect(mockExport).toHaveBeenCalledWith({
    config: {
      ...displayedInput.config,
      filters: {
        ...displayedInput.config.filters,
        dateRange: 'custom',
        customStart: currentPeriod.start,
        customEnd: currentPeriod.end,
      },
    },
    format: 'csv',
  }));
  expect(mockExport).toHaveBeenCalledTimes(1);

  finishExport(csv);
  await waitFor(() => expect(Share.share).toHaveBeenCalledWith({
    message: csv.data,
    title: translate('reports.csv_title', currentPeriod),
  }));
  expect(Share.share).toHaveBeenCalledTimes(1);
  expect(csvButton()).toBeDisabled();

  await act(async () => finishShare({ action: Share.dismissedAction }));
  await waitFor(() => expect(csvButton()).toBeEnabled());
});
